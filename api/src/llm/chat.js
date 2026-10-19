import { config } from "../config.js";
import { ErroTransitorio } from "../erros.js";

// Cliente de chat no formato da OpenAI (POST /v1/chat/completions).
//
// OpenAI, Ollama, Groq, xAI e vLLM falam esse mesmo formato, então um cliente
// só basta: trocar de provedor é trocar LLM_BASE_URL, LLM_API_KEY e o modelo.
// Sem SDK de propósito: é um fetch, e dá para ver exatamente o que vai e volta.

/**
 * Mensagem no formato da API. O papel "tool" carrega a resposta de uma
 * ferramenta que o modelo pediu (modo agente).
 * @typedef {{ role: "system" | "user", content: string }
 *   | { role: "assistant", content: string | null, tool_calls?: ChamadaBruta[] }
 *   | { role: "tool", tool_call_id: string, content: string }} MensagemChat
 */

/**
 * @typedef {object} ChamadaBruta
 * @property {string} id
 * @property {"function"} type
 * @property {{ name: string, arguments: string }} function arguments é um JSON em texto
 */

/**
 * Descrição de uma ferramenta, no JSON Schema que o modelo entende.
 * @typedef {{ type: "function", function: { name: string, description: string, parameters: Record<string, unknown> } }} Ferramenta
 */

/**
 * @typedef {object} RespostaChat
 * @property {string} conteudo
 * @property {{ id: string, nome: string, argumentos: Record<string, unknown>, bruto: ChamadaBruta }[]} chamadas
 * @property {{ entrada: number, saida: number }} uso tokens
 */

export function llmDisponivel() {
  return config.llm.provider === "openai_compat";
}

// Modelos de raciocínio da OpenAI (o1, o3, o4-mini, gpt-5...) não aceitam
// `temperature` e gastam parte do limite de tokens "pensando" antes de
// responder. Com eles, mandamos um limite maior para sobrar espaço para a
// resposta. Para este projeto um modelo sem raciocínio (gpt-4.1-mini) é o
// melhor custo-benefício: as respostas são curtas e o contexto já vem pronto.
const MODELO_RACIOCINIO = /^(o\d|gpt-5)/i;

/**
 * Monta o corpo da requisição respeitando as diferenças entre provedores.
 * @param {MensagemChat[]} mensagens
 * @param {number} maxTokens
 * @param {boolean} stream
 */
function corpoBase(mensagens, maxTokens, stream) {
  const modelo = config.llm.chatModel;
  const raciocinio = MODELO_RACIOCINIO.test(modelo);
  /** @type {Record<string, unknown>} */
  const corpo = { model: modelo, messages: mensagens, stream };
  // A OpenAI trocou `max_tokens` por `max_completion_tokens`; os compatíveis
  // (Ollama, Groq, vLLM) ainda esperam o nome antigo.
  const openai = config.llm.baseUrl.includes("api.openai.com");
  corpo[openai ? "max_completion_tokens" : "max_tokens"] = raciocinio ? maxTokens + 4000 : maxTokens;
  // Temperatura baixa: queremos respostas fiéis ao código, não criativas.
  if (!raciocinio) corpo.temperature = 0.2;
  return corpo;
}

/**
 * Chama o modelo. Com `aoToken`, usa streaming e entrega cada pedaço de
 * texto assim que chega (é o que faz a resposta "digitar" no chat).
 * @param {object} o
 * @param {MensagemChat[]} o.mensagens
 * @param {Ferramenta[]} [o.ferramentas]
 * @param {number} [o.maxTokens]
 * @param {(t: string) => void} [o.aoToken]
 * @param {AbortSignal} [o.sinal]
 * @returns {Promise<RespostaChat>}
 */
export async function chat(o) {
  const corpo = corpoBase(o.mensagens, o.maxTokens ?? 1200, !!o.aoToken);
  if (o.ferramentas?.length) corpo.tools = o.ferramentas;
  if (o.aoToken) corpo.stream_options = { include_usage: true }; // uso de tokens no último pedaço

  let res;
  try {
    res = await fetch(`${config.llm.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.llm.apiKey}` },
      body: JSON.stringify(corpo),
      signal: o.sinal ? AbortSignal.any([o.sinal, AbortSignal.timeout(180_000)]) : AbortSignal.timeout(180_000),
    });
  } catch (e) {
    throw new ErroTransitorio(`LLM indisponível: ${/** @type {Error} */ (e).message}`);
  }
  // O corpo do erro da OpenAI não contém a chave, mas cortamos mesmo assim
  // para não encher o log.
  if (!res.ok) throw new ErroTransitorio(`LLM: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);

  if (!o.aoToken) {
    const j = await res.json();
    const m = j.choices?.[0]?.message ?? { content: "" };
    return {
      conteudo: m.content ?? "",
      chamadas: (m.tool_calls ?? []).map(parseChamada),
      uso: { entrada: j.usage?.prompt_tokens ?? 0, saida: j.usage?.completion_tokens ?? 0 },
    };
  }

  // Streaming: a resposta vem como SSE, uma linha "data: {json}" por pedaço.
  // O texto chega em `delta.content`; as chamadas de ferramenta chegam
  // fatiadas em `delta.tool_calls`, e montamos cada uma pelo índice.
  let conteudo = "";
  /** @type {ChamadaBruta[]} */
  const parciais = [];
  let uso = { entrada: 0, saida: 0 };
  const leitor = /** @type {ReadableStream<Uint8Array>} */ (res.body).pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await leitor.read();
    if (done) break;
    buffer += value;
    const linhas = buffer.split("\n");
    buffer = linhas.pop() ?? ""; // a última linha pode estar pela metade
    for (const l of linhas) {
      const dado = l.startsWith("data:") ? l.slice(5).trim() : "";
      if (!dado || dado === "[DONE]") continue;
      let j;
      try {
        j = JSON.parse(dado);
      } catch {
        continue;
      }
      const d = j.choices?.[0]?.delta;
      if (d?.content) {
        conteudo += d.content;
        o.aoToken(d.content);
      }
      for (const tc of d?.tool_calls ?? []) {
        const p = (parciais[tc.index] ??= { id: tc.id ?? `call_${tc.index}`, type: "function", function: { name: "", arguments: "" } });
        if (tc.id) p.id = tc.id;
        if (tc.function?.name) p.function.name += tc.function.name;
        if (tc.function?.arguments) p.function.arguments += tc.function.arguments;
      }
      if (j.usage) uso = { entrada: j.usage.prompt_tokens, saida: j.usage.completion_tokens };
    }
  }
  return { conteudo, chamadas: parciais.filter(Boolean).map(parseChamada), uso };
}

/**
 * Os argumentos chegam como TEXTO JSON gerado pelo modelo, que pode vir
 * quebrado. Nesse caso a ferramenta recebe um aviso em vez de explodir.
 * @param {ChamadaBruta} c
 */
function parseChamada(c) {
  /** @type {Record<string, unknown>} */
  let argumentos = {};
  try {
    argumentos = JSON.parse(c.function.arguments || "{}");
  } catch {
    argumentos = { _erro: "argumentos não são JSON válido" };
  }
  return { id: c.id, nome: c.function.name, argumentos, bruto: c };
}

/**
 * Estimativa grosseira (4 caracteres ≈ 1 token) para limitar o contexto
 * quando o provedor não devolve o uso.
 * @param {string} s
 */
export const estimarTokens = (s) => Math.ceil(s.length / 4);
