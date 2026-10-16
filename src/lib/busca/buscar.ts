import { db } from "../db";
import { cosseno, embedConsulta, modeloEmbedding } from "../llm/embeddings";
import { tokenizar } from "../indexacao/tokenizar";
import type { Chunk, Repositorio } from "../tipos";

// Busca híbrida (context.md, seção 11), feita em memória sobre o índice do Mongo:
//   1. vetorial (cosseno)  2. textual (BM25)  3. fusão RRF  4. expansão por grafo.
// Fazer em memória mantém o MVP independente de Atlas Vector Search e deixa
// cada etapa explícita. Para repositórios grandes, trocar por $vectorSearch.

type ChunkLeve = Pick<Chunk, "_id" | "repoId" | "path" | "simbolo" | "tipo" | "linhaInicio" | "linhaFim" | "commitSha" | "embedding" | "tokens" | "referencias">;

interface IndiceRepo {
  versao: number;
  modelo: string | null;
  chunks: ChunkLeve[];
  df: Map<string, number>;
  somaTam: number;
}

const g = globalThis as unknown as { _indices?: Map<string, IndiceRepo> };
const cache = (g._indices ??= new Map());

async function indiceDe(repo: Repositorio): Promise<IndiceRepo> {
  const atual = cache.get(repo._id);
  if (atual && atual.versao === repo.versaoIndice) return atual;
  const chunks = await (await db())
    .collection<Chunk>("chunks")
    .find({ repoId: repo._id }, { projection: { conteudo: 0, cabecalho: 0, hashTexto: 0, criadoEm: 0, atualizadoEm: 0 } })
    .toArray();
  const df = new Map<string, number>();
  let somaTam = 0;
  for (const c of chunks) {
    somaTam += c.tokens.length;
    for (const t of new Set(c.tokens)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const idx = { versao: repo.versaoIndice, modelo: repo.embedModelo, chunks, df, somaTam };
  cache.set(repo._id, idx);
  if (cache.size > 50) cache.delete(cache.keys().next().value!);
  return idx;
}

export interface Resultado {
  chunk: Chunk;
  repo: Pick<Repositorio, "_id" | "ghOwner" | "ghNome">;
  scores: { vetorial: number | null; textual: number | null; rrf: number; posVetorial: number | null; posTextual: number | null };
  viaGrafo: boolean;
}

const K_RRF = 60;
const TOP_CANDIDATOS = 30;

// repoIds JÁ devem vir autorizados (do bot / do dono). Toda busca é restrita a eles.
export async function buscar(o: { repoIds: string[]; consulta: string; k?: number; grafo?: boolean }): Promise<{ resultados: Resultado[]; avisos: string[] }> {
  const k = o.k ?? 6;
  const avisos: string[] = [];
  const d = await db();
  const repos = await d.collection<Repositorio>("repositorios").find({ _id: { $in: o.repoIds }, status: { $in: ["pronto", "indexando"] } }).toArray();
  if (!repos.length) return { resultados: [], avisos: ["Nenhum repositório indexado para buscar."] };

  const indices = await Promise.all(repos.map(indiceDe));
  const todos = indices.flatMap((i) => i.chunks);
  if (!todos.length) return { resultados: [], avisos: ["Os repositórios ainda não têm trechos indexados."] };

  // 1. Vetorial — só nos repositórios indexados com o modelo de embedding atual.
  const modelo = modeloEmbedding();
  const compativeis = indices.filter((i) => i.modelo === modelo).flatMap((i) => i.chunks);
  if (compativeis.length < todos.length) avisos.push("Alguns repositórios foram indexados com outro modelo de embedding; sincronize-os para usar a busca vetorial.");
  let rankVet: { c: ChunkLeve; s: number }[] = [];
  if (compativeis.length) {
    const q = await embedConsulta(o.consulta);
    rankVet = compativeis.map((c) => ({ c, s: cosseno(q, c.embedding) })).sort((a, b) => b.s - a.s).slice(0, TOP_CANDIDATOS);
  }

  // 2. Textual — BM25 sobre os tokens (pega identificadores exatos que o embedding erra).
  const termos = [...new Set(tokenizar(o.consulta))];
  const N = todos.length;
  const df = new Map<string, number>();
  for (const i of indices) for (const t of termos) df.set(t, (df.get(t) ?? 0) + (i.df.get(t) ?? 0));
  const media = indices.reduce((s, i) => s + i.somaTam, 0) / N || 1;
  const rankTxt = todos
    .map((c) => ({ c, s: bm25(c.tokens, termos, df, N, media) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, TOP_CANDIDATOS);

  // 3. Reciprocal Rank Fusion: score = Σ 1 / (60 + posição). Não precisa
  //    calibrar as escalas diferentes de cosseno e BM25, só as posições.
  const fusao = new Map<string, { c: ChunkLeve; rrf: number; v: number | null; t: number | null; pv: number | null; pt: number | null }>();
  const pegar = (c: ChunkLeve) => fusao.get(c._id) ?? fusao.set(c._id, { c, rrf: 0, v: null, t: null, pv: null, pt: null }).get(c._id)!;
  rankVet.forEach(({ c, s }, i) => Object.assign(pegar(c), { v: s, pv: i + 1 }).rrf += 1 / (K_RRF + i + 1));
  rankTxt.forEach(({ c, s }, i) => Object.assign(pegar(c), { t: s, pt: i + 1 }).rrf += 1 / (K_RRF + i + 1));
  const topo = [...fusao.values()].sort((a, b) => b.rrf - a.rrf).slice(0, k);

  // 4. Expansão por grafo (1 salto): quem os 5 primeiros chamam e quem os chama.
  const extras: ChunkLeve[] = [];
  if (o.grafo) {
    const ja = new Set(topo.map((x) => x.c._id));
    const nomesUsados = new Set(topo.map((x) => nomeCurto(x.c.simbolo)));
    const codigo = (c: ChunkLeve) => c.tipo === "funcao" || c.tipo === "metodo" || c.tipo === "classe";
    for (const { c } of topo.slice(0, 5)) {
      if (!codigo(c)) continue;
      const nome = nomeCurto(c.simbolo);
      for (const outro of todos) {
        if (extras.length >= 5) break;
        const nomeOutro = nomeCurto(outro.simbolo);
        // só código, do mesmo repo, e uma parte por símbolo (funções longas têm várias)
        if (!codigo(outro) || ja.has(outro._id) || outro.repoId !== c.repoId || !nomeOutro || nomesUsados.has(nomeOutro)) continue;
        const chamado = c.referencias.includes(nomeOutro);
        const chamador = !!nome && outro.referencias.includes(nome);
        if (chamado || chamador) {
          extras.push(outro);
          ja.add(outro._id);
          nomesUsados.add(nomeOutro);
        }
      }
    }
  }

  const ids = [...topo.map((x) => x.c._id), ...extras.map((c) => c._id)];
  const completos = new Map((await d.collection<Chunk>("chunks").find({ _id: { $in: ids } }).toArray()).map((c) => [c._id, c]));
  const repoPorId = new Map(repos.map((r) => [r._id, { _id: r._id, ghOwner: r.ghOwner, ghNome: r.ghNome }]));

  const resultados: Resultado[] = [];
  for (const x of topo) {
    const chunk = completos.get(x.c._id);
    if (chunk) resultados.push({ chunk, repo: repoPorId.get(chunk.repoId)!, scores: { vetorial: x.v, textual: x.t, rrf: x.rrf, posVetorial: x.pv, posTextual: x.pt }, viaGrafo: false });
  }
  for (const c of extras) {
    const chunk = completos.get(c._id);
    if (chunk) resultados.push({ chunk, repo: repoPorId.get(chunk.repoId)!, scores: { vetorial: null, textual: null, rrf: 0, posVetorial: null, posTextual: null }, viaGrafo: true });
  }
  return { resultados, avisos };
}

// "JwtService.verify" -> "verify"; "login, logout" -> "login"
function nomeCurto(s: string | null): string {
  if (!s) return "";
  const base = s.split(/[\s(,]/)[0];
  return base.split(".").pop() ?? base;
}

function bm25(tokens: string[], termos: string[], df: Map<string, number>, N: number, media: number, k1 = 1.2, b = 0.75): number {
  if (!termos.length) return 0;
  let s = 0;
  const len = tokens.length;
  for (const t of termos) {
    let tf = 0;
    for (const x of tokens) if (x === t) tf++;
    if (!tf) continue;
    const n = df.get(t) ?? 0;
    const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
    s += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * len) / media)));
  }
  return s;
}
