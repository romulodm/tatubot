import { config } from "../config";
import { ErroTransitorio } from "../erros";

// Cliente de chat compatível com OpenAI (/v1/chat/completions).
// Ollama, OpenAI, Groq, xAI e vLLM falam esse formato, então um cliente só basta.

export type MensagemChat =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ChamadaBruta[] }
  | { role: "tool"; tool_call_id: string; content: string };

interface ChamadaBruta {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface Ferramenta {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface RespostaChat {
  conteudo: string;
  chamadas: { id: string; nome: string; argumentos: Record<string, unknown>; bruto: ChamadaBruta }[];
  uso: { entrada: number; saida: number };
}

export function llmDisponivel() {
  return config.llm.provider === "openai_compat";
}

export async function chat(o: {
  mensagens: MensagemChat[];
  ferramentas?: Ferramenta[];
  maxTokens?: number;
  aoToken?: (t: string) => void;
  sinal?: AbortSignal;
}): Promise<RespostaChat> {
  const corpo: Record<string, unknown> = {
    model: config.llm.chatModel,
    messages: o.mensagens,
    max_tokens: o.maxTokens ?? 1200,
    temperature: 0.2,
    stream: !!o.aoToken,
  };
  if (o.ferramentas?.length) corpo.tools = o.ferramentas;
  if (o.aoToken) corpo.stream_options = { include_usage: true };

  let res: Response;
  try {
    res = await fetch(`${config.llm.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.llm.apiKey}` },
      body: JSON.stringify(corpo),
      signal: o.sinal ? AbortSignal.any([o.sinal, AbortSignal.timeout(180_000)]) : AbortSignal.timeout(180_000),
    });
  } catch (e) {
    throw new ErroTransitorio(`LLM indisponível: ${(e as Error).message}`);
  }
  if (!res.ok) throw new ErroTransitorio(`LLM: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);

  if (!o.aoToken) {
    const j = (await res.json()) as {
      choices: { message: { content: string | null; tool_calls?: ChamadaBruta[] } }[];
      usage?: { prompt_tokens: number; completion_tokens: number };
    };
    const m = j.choices[0]?.message ?? { content: "" };
    return {
      conteudo: m.content ?? "",
      chamadas: (m.tool_calls ?? []).map(parseChamada),
      uso: { entrada: j.usage?.prompt_tokens ?? 0, saida: j.usage?.completion_tokens ?? 0 },
    };
  }

  // Streaming SSE: acumula conteúdo e deltas de tool_calls por índice.
  let conteudo = "";
  const parciais: ChamadaBruta[] = [];
  let uso = { entrada: 0, saida: 0 };
  const leitor = res.body!.pipeThrough(new TextDecoderStream()).getReader();
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
      let j: {
        choices?: { delta?: { content?: string; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] } }[];
        usage?: { prompt_tokens: number; completion_tokens: number };
      };
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

function parseChamada(c: ChamadaBruta) {
  let argumentos: Record<string, unknown> = {};
  try {
    argumentos = JSON.parse(c.function.arguments || "{}");
  } catch {
    argumentos = { _erro: "argumentos não são JSON válido" };
  }
  return { id: c.id, nome: c.function.name, argumentos, bruto: c };
}

// Estimativa grosseira (4 caracteres ≈ 1 token) para limitar o contexto
// quando o provedor não devolve uso.
export const estimarTokens = (s: string) => Math.ceil(s.length / 4);
