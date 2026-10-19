import { config } from "../config.js";
import { ErroTransitorio } from "../erros.js";
import { tokenizar } from "../indexacao/tokenizar.js";

// Embeddings: transformar texto em um vetor de números de forma que textos
// parecidos fiquem próximos (ver docs/rag/04-embeddings.md).
//
// Dois provedores atrás da mesma interface:
// - remoto: qualquer API compatível com OpenAI (/v1/embeddings). Com a OpenAI,
//   o padrão é text-embedding-3-small (1536 dimensões).
// - local: "feature hashing" de termos. Sem rede e sem modelo: captura
//   sobreposição de vocabulário (não sinônimos). Serve para o projeto rodar
//   em qualquer máquina e como linha de base para comparar com um modelo real.

const DIM_LOCAL = 512;
const LOTE = 32; // textos por requisição

/**
 * Nome do modelo em uso. Fica gravado no repositório indexado: se mudar,
 * os vetores antigos não servem mais e o repo precisa ser reindexado.
 */
export function modeloEmbedding() {
  return usarRemoto() ? config.llm.embedModel : `local-hash-${DIM_LOCAL}`;
}

function usarRemoto() {
  return config.llm.provider === "openai_compat" && !!config.llm.embedModel;
}

/**
 * Embeddings dos trechos de código (lado do índice).
 * @param {string[]} textos
 * @returns {Promise<number[][]>}
 */
export async function embedDocumentos(textos) {
  if (!usarRemoto()) return textos.map(embedLocal);
  /** @type {number[][]} */
  const r = [];
  for (let i = 0; i < textos.length; i += LOTE) {
    r.push(...(await embedRemoto(textos.slice(i, i + LOTE).map((t) => config.llm.prefixoDoc + t))));
  }
  return r;
}

/**
 * Embedding da pergunta (lado da consulta). Alguns modelos usam prefixos
 * diferentes para documento e consulta; a OpenAI não usa nenhum.
 * @param {string} texto
 */
export async function embedConsulta(texto) {
  if (!usarRemoto()) return embedLocal(texto);
  return (await embedRemoto([config.llm.prefixoConsulta + texto]))[0];
}

/** @param {string[]} input @returns {Promise<number[][]>} */
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
    throw new ErroTransitorio(`embeddings indisponíveis: ${/** @type {Error} */ (e).message}`);
  }
  if (!res.ok) throw new ErroTransitorio(`embeddings: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const corpo = /** @type {{ data: { embedding: number[], index: number }[] }} */ (await res.json());
  // A API devolve um `index` por item; ordenamos por ele por garantia.
  return corpo.data.sort((a, b) => a.index - b.index).map((d) => normalizar(d.embedding));
}

/**
 * Embedding local por feature hashing: cada termo cai numa das 512 posições
 * do vetor pelo hash do texto. Dois trechos com os mesmos termos acabam com
 * vetores parecidos. Não entende sinônimo ("login" e "signin" ficam longe),
 * por isso a busca tem o glossário PT -> EN em busca/consulta.js.
 * @param {string} texto
 */
export function embedLocal(texto) {
  const v = new Float64Array(DIM_LOCAL);
  /** @type {Map<string, number>} */
  const tf = new Map();
  for (const t of tokenizar(texto)) tf.set(t, (tf.get(t) ?? 0) + 1);
  for (const [t, n] of tf) {
    const peso = 1 + Math.log(n); // repetir um termo ajuda, mas cada vez menos
    somar(v, t, peso);
    // trigramas de caractere aproximam variações (token/tokens, verify/verifier)
    if (t.length >= 5) for (let i = 0; i + 3 <= t.length; i++) somar(v, `#${t.slice(i, i + 3)}`, peso * 0.25);
  }
  return normalizar(Array.from(v));
}

/** @param {Float64Array} v @param {string} termo @param {number} peso */
function somar(v, termo, peso) {
  const h = fnv1a(termo);
  v[h % DIM_LOCAL] += h & 0x80000000 ? -peso : peso; // sinal pelo bit alto reduz o efeito das colisões
}

/** Hash FNV-1a de 32 bits: simples, rápido e bem espalhado. @param {string} s */
function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Deixa o vetor com comprimento 1. Assim o cosseno vira um produto escalar
 * simples. Arredondamos para 5 casas para o documento no Mongo ficar menor.
 * @param {number[]} v
 */
export function normalizar(v) {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map((x) => Math.round((x / n) * 1e5) / 1e5);
}

/**
 * Similaridade de cosseno: 1 = mesma direção, 0 = nada a ver.
 * @param {number[]} a @param {number[]} b vetores já normalizados
 */
export function cosseno(a, b) {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}
