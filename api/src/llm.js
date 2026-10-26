import { config } from "./config.js";
import { ErroTransitorio } from "./erros.js";
import { tokenizar } from "./busca/consulta.js";

export function llmDisponivel() {
  return config.llm.provider === "openai_compat";
}

const MODELO_RACIOCINIO = /^(o\d|gpt-5)/i;

function corpoBase(mensagens, maxTokens, stream) {
  const modelo = config.llm.chatModel;
  const raciocinio = MODELO_RACIOCINIO.test(modelo);
  const corpo = { model: modelo, messages: mensagens, stream };
  const openai = config.llm.baseUrl.includes("api.openai.com");
  corpo[openai ? "max_completion_tokens" : "max_tokens"] = raciocinio ? maxTokens + 4000 : maxTokens;
  if (!raciocinio) corpo.temperature = 0.2;
  return corpo;
}

export async function chat(o) {
  const corpo = corpoBase(o.mensagens, o.maxTokens ?? 1200, !!o.aoToken);
  if (o.ferramentas?.length) corpo.tools = o.ferramentas;
  if (o.aoToken) corpo.stream_options = { include_usage: true };

  let res;
  try {
    res = await fetch(`${config.llm.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.llm.apiKey}` },
      body: JSON.stringify(corpo),
      signal: o.sinal ? AbortSignal.any([o.sinal, AbortSignal.timeout(180_000)]) : AbortSignal.timeout(180_000),
    });
  } catch (e) {
    throw new ErroTransitorio(`LLM indisponível: ${e.message}`);
  }
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

  let conteudo = "";
  const parciais = [];
  let uso = { entrada: 0, saida: 0 };
  const leitor = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await leitor.read();
    if (done) break;
    buffer += value;
    const linhas = buffer.split("\n");
    buffer = linhas.pop() ?? "";
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

function parseChamada(c) {
  let argumentos;
  try {
    argumentos = JSON.parse(c.function.arguments || "{}");
  } catch {
    argumentos = { _erro: "argumentos não são JSON válido" };
  }
  return { id: c.id, nome: c.function.name, argumentos, bruto: c };
}

export const estimarTokens = (s) => Math.ceil(s.length / 4);

// ---------- embeddings ----------
// Sem modelo de embedding configurado, usa hashing de termos (512 dimensões).

const DIM_LOCAL = 512;
const LOTE = 32;

export function modeloEmbedding() {
  return usarRemoto() ? config.llm.embedModel : `local-hash-${DIM_LOCAL}`;
}

function usarRemoto() {
  return config.llm.provider === "openai_compat" && !!config.llm.embedModel;
}

export async function embedDocumentos(textos) {
  if (!usarRemoto()) return textos.map(embedLocal);
  const r = [];
  for (let i = 0; i < textos.length; i += LOTE) {
    r.push(...(await embedRemoto(textos.slice(i, i + LOTE).map((t) => config.llm.prefixoDoc + t))));
  }
  return r;
}

export async function embedConsulta(texto) {
  if (!usarRemoto()) return embedLocal(texto);
  return (await embedRemoto([config.llm.prefixoConsulta + texto]))[0];
}

async function embedRemoto(input) {
  let res;
  try {
    res = await fetch(`${config.llm.baseUrl}/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.llm.apiKey}` },
      body: JSON.stringify({ model: config.llm.embedModel, input }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (e) {
    throw new ErroTransitorio(`embeddings indisponíveis: ${e.message}`);
  }
  if (!res.ok) throw new ErroTransitorio(`embeddings: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const corpo = await res.json();
  return corpo.data.sort((a, b) => a.index - b.index).map((d) => normalizarVetor(d.embedding));
}

export function embedLocal(texto) {
  const v = new Float64Array(DIM_LOCAL);
  const tf = new Map();
  for (const t of tokenizar(texto)) tf.set(t, (tf.get(t) ?? 0) + 1);
  for (const [t, n] of tf) {
    const peso = 1 + Math.log(n);
    somar(v, t, peso);
    if (t.length >= 5) for (let i = 0; i + 3 <= t.length; i++) somar(v, `#${t.slice(i, i + 3)}`, peso * 0.25);
  }
  return normalizarVetor(Array.from(v));
}

function somar(v, termo, peso) {
  const h = fnv1a(termo);
  v[h % DIM_LOCAL] += h & 0x80000000 ? -peso : peso;
}

function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function normalizarVetor(v) {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map((x) => Math.round((x / n) * 1e5) / 1e5);
}

export function cosseno(a, b) {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}
