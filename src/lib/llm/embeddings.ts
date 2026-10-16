import { config } from "../config";
import { ErroTransitorio } from "../erros";
import { tokenizar } from "../indexacao/tokenizar";

// Dois provedores de embedding atrás da mesma interface:
// - remoto: qualquer API compatível com OpenAI (/v1/embeddings), inclusive Ollama;
// - local: "feature hashing" de termos. Sem rede e sem modelo: captura
//   sobreposição de vocabulário (não sinônimos), suficiente para o MVP rodar
//   em qualquer máquina e para comparar com um modelo de verdade na avaliação.

const DIM_LOCAL = 512;
const LOTE = 32;

export function modeloEmbedding(): string {
  return usarRemoto() ? config.llm.embedModel : `local-hash-${DIM_LOCAL}`;
}

function usarRemoto() {
  return config.llm.provider === "openai_compat" && !!config.llm.embedModel;
}

export async function embedDocumentos(textos: string[]): Promise<number[][]> {
  if (!usarRemoto()) return textos.map(embedLocal);
  const r: number[][] = [];
  for (let i = 0; i < textos.length; i += LOTE) {
    r.push(...(await embedRemoto(textos.slice(i, i + LOTE).map((t) => config.llm.prefixoDoc + t))));
  }
  return r;
}

export async function embedConsulta(texto: string): Promise<number[]> {
  if (!usarRemoto()) return embedLocal(texto);
  return (await embedRemoto([config.llm.prefixoConsulta + texto]))[0];
}

async function embedRemoto(input: string[]): Promise<number[][]> {
  let res: Response;
  try {
    res = await fetch(`${config.llm.baseUrl}/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.llm.apiKey}` },
      body: JSON.stringify({ model: config.llm.embedModel, input }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (e) {
    throw new ErroTransitorio(`embeddings indisponíveis: ${(e as Error).message}`);
  }
  if (!res.ok) throw new ErroTransitorio(`embeddings: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const corpo = (await res.json()) as { data: { embedding: number[]; index: number }[] };
  return corpo.data.sort((a, b) => a.index - b.index).map((d) => normalizar(d.embedding));
}

export function embedLocal(texto: string): number[] {
  const v = new Float64Array(DIM_LOCAL);
  const tf = new Map<string, number>();
  for (const t of tokenizar(texto)) tf.set(t, (tf.get(t) ?? 0) + 1);
  for (const [t, n] of tf) {
    const peso = 1 + Math.log(n);
    somar(v, t, peso);
    // trigramas de caractere aproximam variações (token/tokens, verify/verifier)
    if (t.length >= 5) for (let i = 0; i + 3 <= t.length; i++) somar(v, `#${t.slice(i, i + 3)}`, peso * 0.25);
  }
  return normalizar(Array.from(v));
}

function somar(v: Float64Array, termo: string, peso: number) {
  const h = fnv1a(termo);
  v[h % DIM_LOCAL] += h & 0x80000000 ? -peso : peso; // sinal reduz colisões
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function normalizar(v: number[]): number[] {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map((x) => Math.round((x / n) * 1e5) / 1e5);
}

export function cosseno(a: number[], b: number[]): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s; // vetores já normalizados
}
