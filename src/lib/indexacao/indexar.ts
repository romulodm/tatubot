import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, rm, mkdir, lstat } from "node:fs/promises";
import path from "node:path";
import { config } from "../config";
import { db, agora } from "../db";
import { log } from "../log";
import { embedDocumentos, modeloEmbedding } from "../llm/embeddings";
import type { Arquivo, Chunk, Repositorio } from "../tipos";
import { quebrarEmChunks, type ChunkBruto } from "./chunker";
import { motivoIgnorarCaminho, motivoIgnorarConteudo, linguagem } from "./filtros";
import { buscarAtualizacao, checkout, clonar, diff, ehAncestral, head, listarArquivos } from "./git";
import { detectarSegredo } from "./segredos";
import { tokenizar } from "./tokenizar";

export const dirRepo = (repoId: string) => path.resolve(config.reposDir, repoId);

interface Estatisticas {
  gerados: number;
  reaproveitados: number;
}

// Ponto de entrada do consumidor de repo.cadastrado / repo.sincronizar.
// A coleção `repositorios` faz o papel da projeção: se o documento sumiu
// (repo removido enquanto o evento esperava na fila), o evento é descartado.
export async function indexar(repoId: string, correlationId: string) {
  const d = await db();
  const repos = d.collection<Repositorio>("repositorios");
  const repo = await repos.findOne({ _id: repoId });
  if (!repo) {
    log("info", "evento de repo removido ignorado", { repoId, correlationId });
    return;
  }

  const dir = dirRepo(repoId);
  const modelo = modeloEmbedding();
  await repos.updateOne({ _id: repoId }, { $set: { status: "indexando", erro: null, progresso: { etapa: "clonando", processados: 0, total: 0 }, atualizadoEm: agora() } });

  const est: Estatisticas = { gerados: 0, reaproveitados: 0 };
  let modo: "completa" | "incremental" | "nada" = "completa";
  let sha: string;

  const podeIncremental = existsSync(path.join(dir, ".git")) && repo.ultimoCommit && repo.embedModelo === modelo;
  if (podeIncremental) {
    const novo = await buscarAtualizacao(dir, repo.branch);
    if (novo === repo.ultimoCommit) {
      modo = "nada";
      sha = novo;
    } else if (await ehAncestral(dir, repo.ultimoCommit!, novo)) {
      modo = "incremental";
      await checkout(dir, novo);
      sha = novo;
      await reindexarDiff(repo, dir, repo.ultimoCommit!, novo, est);
    } else {
      // force push: o commit indexado não está mais no histórico
      log("aviso", "histórico reescrito, reindexação completa", { repoId, correlationId });
      await checkout(dir, novo);
      sha = novo;
      await indexarTudo(repo, dir, sha, est);
    }
  } else {
    await rm(dir, { recursive: true, force: true });
    await mkdir(path.dirname(dir), { recursive: true });
    const branch = await clonar(repo.url, repo.branch, dir);
    if (branch !== repo.branch) {
      repo.branch = branch;
      await repos.updateOne({ _id: repoId }, { $set: { branch } });
    }
    sha = await head(dir);
    await indexarTudo(repo, dir, sha, est);
  }

  const [totalArquivos, totalChunks] = await Promise.all([
    d.collection("arquivos").countDocuments({ repoId, status: "indexado" }),
    d.collection("chunks").countDocuments({ repoId }),
  ]);
  await repos.updateOne(
    { _id: repoId },
    {
      $set: {
        status: "pronto",
        ultimoCommit: sha,
        embedModelo: modelo,
        totalArquivos,
        totalChunks,
        progresso: null,
        ultimaIndexacao: { embeddingsGerados: est.gerados, embeddingsReaproveitados: est.reaproveitados, modo },
        atualizadoEm: agora(),
      },
      $inc: { versaoIndice: 1 }, // invalida o cache de busca
    },
  );
  log("info", "repo indexado", { repoId, correlationId, modo, sha, totalArquivos, totalChunks, ...est });
}

async function indexarTudo(repo: Repositorio, dir: string, sha: string, est: Estatisticas) {
  const d = await db();
  const cache = await cacheEmbeddings(repo);
  const caminhos = (await listarArquivos(dir)).slice(0, config.limites.arquivosPorRepo);

  const arquivos: Arquivo[] = [];
  const brutos: ChunkBruto[] = [];
  for (const [i, p] of caminhos.entries()) {
    const r = await processarArquivo(repo._id, dir, p);
    arquivos.push(r.arquivo);
    brutos.push(...r.chunks);
    if (i % 200 === 0) await progresso(repo._id, "lendo arquivos", i, caminhos.length);
  }

  const chunks = await embeddar(repo, brutos, sha, cache, est);
  await d.collection("arquivos").deleteMany({ repoId: repo._id });
  await d.collection("chunks").deleteMany({ repoId: repo._id });
  await inserirEmLotes("arquivos", arquivos);
  await inserirEmLotes("chunks", chunks);
}

async function reindexarDiff(repo: Repositorio, dir: string, antigo: string, novo: string, est: Estatisticas) {
  const d = await db();
  const mudancas = await diff(dir, antigo, novo);
  const cache = await cacheEmbeddings(repo);
  const remover = new Set<string>();
  const processar = new Set<string>();
  for (const m of mudancas) {
    if (m.status === "D") remover.add(m.path);
    else if (m.status === "R") {
      remover.add(m.antigo!);
      processar.add(m.path);
    } else processar.add(m.path);
  }
  const tocados = [...new Set([...remover, ...processar])];
  await d.collection("arquivos").deleteMany({ repoId: repo._id, path: { $in: tocados } });
  await d.collection("chunks").deleteMany({ repoId: repo._id, path: { $in: tocados } });

  const arquivos: Arquivo[] = [];
  const brutos: ChunkBruto[] = [];
  for (const p of processar) {
    const r = await processarArquivo(repo._id, dir, p);
    arquivos.push(r.arquivo);
    brutos.push(...r.chunks);
  }
  // Chunks dos outros arquivos só precisam do commit novo para os links.
  await d.collection("chunks").updateMany({ repoId: repo._id }, { $set: { commitSha: novo } });
  const chunks = await embeddar(repo, brutos, novo, cache, est);
  await inserirEmLotes("arquivos", arquivos);
  await inserirEmLotes("chunks", chunks);
}

async function processarArquivo(repoId: string, dir: string, p: string): Promise<{ arquivo: Arquivo; chunks: ChunkBruto[] }> {
  const base: Arquivo = {
    _id: randomUUID(),
    repoId,
    path: p,
    hash: "",
    linguagem: linguagem(p),
    tamanhoBytes: 0,
    status: "ignorado",
    motivo: null,
    atualizadoEm: agora(),
  };
  const porCaminho = motivoIgnorarCaminho(p);
  if (porCaminho) return { arquivo: { ...base, motivo: porCaminho }, chunks: [] };

  const abs = path.join(dir, p);
  if (!abs.startsWith(dir + path.sep)) return { arquivo: { ...base, motivo: "caminho_invalido" }, chunks: [] };
  try {
    // lstat: symlinks não são seguidos (poderiam apontar para fora do clone, ex. /etc/passwd).
    const s = await lstat(abs);
    if (s.isSymbolicLink()) return { arquivo: { ...base, motivo: "symlink" }, chunks: [] };
    if (!s.isFile()) return { arquivo: { ...base, motivo: "nao_e_arquivo" }, chunks: [] };
    const buf = await readFile(abs);
    base.tamanhoBytes = buf.length;
    base.hash = createHash("sha1").update(buf).digest("hex");
    const porConteudo = motivoIgnorarConteudo(buf, config.limites.arquivoMaxBytes);
    if (porConteudo) return { arquivo: { ...base, motivo: porConteudo }, chunks: [] };
    const texto = buf.toString("utf8");
    const segredo = detectarSegredo(p, texto);
    if (segredo) return { arquivo: { ...base, motivo: `segredo_detectado:${segredo}` }, chunks: [] };
    return { arquivo: { ...base, status: "indexado" }, chunks: quebrarEmChunks(p, texto) };
  } catch (e) {
    return { arquivo: { ...base, status: "erro", motivo: (e as Error).message.slice(0, 200) }, chunks: [] };
  }
}

// Embedding é reaproveitado pelo hash do TEXTO EMBEDADO (cabeçalho + conteúdo),
// não pela posição: mover uma função de linha não gera embedding novo.
function textoEmbedado(c: ChunkBruto) {
  return `${c.cabecalho}\n${c.conteudo}`;
}

async function cacheEmbeddings(repo: Repositorio): Promise<Map<string, number[]>> {
  const m = new Map<string, number[]>();
  if (repo.embedModelo !== modeloEmbedding()) return m;
  const cur = (await db()).collection<Chunk>("chunks").find({ repoId: repo._id }, { projection: { hashTexto: 1, embedding: 1 } });
  for await (const c of cur) m.set(c.hashTexto, c.embedding);
  return m;
}

async function embeddar(repo: Repositorio, brutos: ChunkBruto[], sha: string, cache: Map<string, number[]>, est: Estatisticas): Promise<Chunk[]> {
  const modelo = modeloEmbedding();
  const hashes = brutos.map((c) => createHash("sha256").update(modelo).update("\0").update(textoEmbedado(c)).digest("hex"));
  const faltando = [...new Set(hashes.filter((h) => !cache.has(h)))];
  const textoPorHash = new Map(brutos.map((c, i) => [hashes[i], textoEmbedado(c)]));

  const LOTE = 32;
  for (let i = 0; i < faltando.length; i += LOTE) {
    const lote = faltando.slice(i, i + LOTE);
    const vetores = await embedDocumentos(lote.map((h) => textoPorHash.get(h)!));
    lote.forEach((h, j) => cache.set(h, vetores[j]));
    await progresso(repo._id, "gerando embeddings", Math.min(i + LOTE, faltando.length), faltando.length);
  }
  est.gerados += faltando.length;
  est.reaproveitados += brutos.length - faltando.length;

  const t = agora();
  return brutos.map((c, i) => ({
    _id: randomUUID(),
    repoId: repo._id,
    path: c.path,
    simbolo: c.simbolo,
    tipo: c.tipo,
    linhaInicio: c.linhaInicio,
    linhaFim: c.linhaFim,
    cabecalho: c.cabecalho,
    conteudo: c.conteudo,
    hashTexto: hashes[i],
    commitSha: sha,
    embedding: cache.get(hashes[i])!,
    tokens: tokenizar(`${c.simbolo ?? ""} ${c.path} ${c.conteudo}`),
    referencias: c.referencias,
    criadoEm: t,
    atualizadoEm: t,
  }));
}

async function inserirEmLotes(colecao: string, docs: object[]) {
  const col = (await db()).collection(colecao);
  for (let i = 0; i < docs.length; i += 500) {
    const lote = docs.slice(i, i + 500);
    if (lote.length) await col.insertMany(lote as never[], { ordered: false });
  }
}

async function progresso(repoId: string, etapa: string, processados: number, total: number) {
  await (await db()).collection<Repositorio>("repositorios").updateOne({ _id: repoId }, { $set: { progresso: { etapa, processados, total } } });
}

export async function limparRepo(repoId: string) {
  const d = await db();
  await d.collection("chunks").deleteMany({ repoId });
  await d.collection("arquivos").deleteMany({ repoId });
  await rm(dirRepo(repoId), { recursive: true, force: true });
}
