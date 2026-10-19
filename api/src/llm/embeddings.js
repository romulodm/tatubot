import { config } from "../config.js";
import { tokenizar } from "../indexacao/tokenizar.js";
import { postarLlm } from "./requisicao.js";

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

// Lotes para a API remota. A OpenAI aceita até 2048 textos e ~300 mil tokens
// por requisição; ficamos bem abaixo para não esbarrar no limite de tokens por
// minuto de contas novas. Várias requisições rodam em paralelo.
const LOTE_TEXTOS = 128;
const LOTE_CARACTERES = 240_000; // ~80 mil tokens (código dá ~3 caracteres por token)
const PARALELAS = 4;
// text-embedding-3-small aceita até 8191 tokens por texto. Um bloco de 60
// linhas de um JSON minificado passa disso fácil, e a API recusa o lote
// inteiro. Cortamos cada texto antes: o começo do trecho basta para o vetor.
const MAX_CARACTERES_TEXTO = 16_000;

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
 * Lote concluído: posições (no array original de textos) e os vetores delas.
 * @typedef {{ indices: number[], vetores: number[][], feitos: number }} LoteConcluido
 */

/**
 * Embeddings dos trechos de código (lado do índice).
 * @param {string[]} textos
 * @param {(lote: LoteConcluido) => void | Promise<void>} [aoLote] chamado a cada lote que fica pronto
 *   (a indexação usa para mostrar o progresso e gravar o checkpoint)
 * @returns {Promise<number[][]>} na mesma ordem dos textos
 */
export async function embedDocumentos(textos, aoLote) {
  // Local é instantâneo e sem rede: sem lotes, sem progresso, sem checkpoint.
  if (!usarRemoto()) return textos.map(embedLocal);

  const lotes = montarLotes(textos.map((t) => (config.llm.prefixoDoc + t).slice(0, MAX_CARACTERES_TEXTO)));
  /** @type {number[][]} */
  const r = new Array(textos.length);
  let feitos = 0;
  let proximo = 0;

  // PARALELAS "trabalhadores" puxam o próximo lote da lista até acabar.
  const trabalhador = async () => {
    while (proximo < lotes.length) {
      const { inicio, itens } = lotes[proximo++];
      const vetores = await embedRemoto(itens);
      vetores.forEach((v, j) => (r[inicio + j] = v));
      feitos += itens.length;
      await aoLote?.({ indices: itens.map((_, j) => inicio + j), vetores, feitos });
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALELAS, lotes.length) }, trabalhador));
  return r;
}

/**
 * Agrupa os textos em lotes respeitando os dois limites (quantidade e tamanho).
 * @param {string[]} textos
 */
function montarLotes(textos) {
  /** @type {{ inicio: number, itens: string[] }[]} */
  const lotes = [];
  let atual = { inicio: 0, itens: /** @type {string[]} */ ([]) };
  let caracteres = 0;
  textos.forEach((t, i) => {
    if (atual.itens.length && (atual.itens.length >= LOTE_TEXTOS || caracteres + t.length > LOTE_CARACTERES)) {
      lotes.push(atual);
      atual = { inicio: i, itens: [] };
      caracteres = 0;
    }
    atual.itens.push(t);
    caracteres += t.length;
  });
  if (atual.itens.length) lotes.push(atual);
  return lotes;
}

/**
 * Embedding da pergunta (lado da consulta). Alguns modelos usam prefixos
 * diferentes para documento e consulta; a OpenAI não usa nenhum.
 * @param {string} texto
 */
export async function embedConsulta(texto) {
  if (!usarRemoto()) return embedLocal(texto);
  return (await embedRemoto([(config.llm.prefixoConsulta + texto).slice(0, MAX_CARACTERES_TEXTO)]))[0];
}

/** @param {string[]} input @returns {Promise<number[][]>} */
async function embedRemoto(input) {
  // 429 e 5xx são tentados de novo lá dentro (ver requisicao.js).
  const res = await postarLlm("/embeddings", { model: config.llm.embedModel, input });
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
