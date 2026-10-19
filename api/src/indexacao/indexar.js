import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, rm, mkdir, lstat } from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { db, agora } from "../db.js";
import { log } from "../log.js";
import { embedDocumentos, modeloEmbedding } from "../llm/embeddings.js";
import { quebrarEmChunks } from "./chunker.js";
import { motivoIgnorarCaminho, motivoIgnorarConteudo, linguagem } from "./filtros.js";
import { buscarAtualizacao, checkout, clonar, diff, ehAncestral, head, listarArquivos } from "./git.js";
import { detectarSegredo } from "./segredos.js";
import { tokenizar } from "./tokenizar.js";

// Orquestra a indexação de um repositório (ver docs/rag/02-indexacao.md):
//
//   clonar/atualizar ─► listar arquivos ─► filtrar ─► varrer segredos
//        ─► quebrar em chunks ─► gerar embeddings ─► gravar no Mongo
//
// Três caminhos possíveis:
//   - completa:    primeiro clone, troca de modelo de embedding ou force push;
//   - incremental: só os arquivos do `git diff` entre o commit antigo e o novo;
//   - nada:        o commit remoto é o mesmo que já está indexado.

/** @typedef {import("../tipos.js").Repositorio} Repositorio */
/** @typedef {import("./chunker.js").ChunkBruto} ChunkBruto */
/** @typedef {{ gerados: number, reaproveitados: number }} Estatisticas */

/** Pasta onde o clone de cada repositório vive. @param {string} repoId */
export const dirRepo = (repoId) => path.resolve(config.reposDir, repoId);

/**
 * Ponto de entrada do consumidor de repo.cadastrado / repo.sincronizar.
 * A coleção `repositorios` diz se o repo ainda existe: se o documento sumiu
 * (repo removido enquanto o evento esperava na fila), o evento é descartado.
 * @param {string} repoId
 * @param {string} correlationId
 */
export async function indexar(repoId, correlationId) {
  const d = await db();
  const repos = d.collection("repositorios");
  const repo = /** @type {Repositorio | null} */ (await repos.findOne({ _id: /** @type {any} */ (repoId) }));
  if (!repo) {
    log("info", "evento de repo removido ignorado", { repoId, correlationId });
    return;
  }

  const dir = dirRepo(repoId);
  const modelo = modeloEmbedding();
  await repos.updateOne(
    { _id: repoId },
    { $set: { status: "indexando", erro: null, progresso: { etapa: "clonando", processados: 0, total: 0 }, atualizadoEm: agora() } },
  );

  /** @type {Estatisticas} */
  const est = { gerados: 0, reaproveitados: 0 };
  /** @type {"completa" | "incremental" | "nada"} */
  let modo = "completa";
  let sha;

  // Incremental só é seguro se o clone ainda existe E o modelo de embedding é
  // o mesmo: vetores de modelos diferentes não são comparáveis entre si.
  const podeIncremental = existsSync(path.join(dir, ".git")) && repo.ultimoCommit && repo.embedModelo === modelo;
  if (podeIncremental) {
    const novo = await buscarAtualizacao(dir, repo.branch);
    if (novo === repo.ultimoCommit) {
      modo = "nada";
      sha = novo;
    } else if (await ehAncestral(dir, repo.ultimoCommit, novo)) {
      modo = "incremental";
      await checkout(dir, novo);
      sha = novo;
      await reindexarDiff(repo, dir, repo.ultimoCommit, novo, est);
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

/**
 * Indexação completa: lê todos os arquivos e substitui o índice inteiro.
 * O índice antigo só é apagado DEPOIS que o novo está pronto, então a busca
 * continua funcionando enquanto a indexação roda.
 * @param {Repositorio} repo @param {string} dir @param {string} sha @param {Estatisticas} est
 */
async function indexarTudo(repo, dir, sha, est) {
  const d = await db();
  const cache = await cacheEmbeddings(repo);
  const caminhos = (await listarArquivos(dir)).slice(0, config.limites.arquivosPorRepo);

  /** @type {import("../tipos.js").Arquivo[]} */
  const arquivos = [];
  /** @type {ChunkBruto[]} */
  const brutos = [];
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

/**
 * Reindexação incremental: só os arquivos que o `git diff` diz que mudaram.
 * @param {Repositorio} repo @param {string} dir @param {string} antigo @param {string} novo @param {Estatisticas} est
 */
async function reindexarDiff(repo, dir, antigo, novo, est) {
  const d = await db();
  const mudancas = await diff(dir, antigo, novo);
  const cache = await cacheEmbeddings(repo);
  /** @type {Set<string>} */
  const remover = new Set();
  /** @type {Set<string>} */
  const processar = new Set();
  for (const m of mudancas) {
    if (m.status === "D") remover.add(m.path);
    else if (m.status === "R") {
      remover.add(/** @type {string} */ (m.antigo));
      processar.add(m.path);
    } else processar.add(m.path);
  }
  const tocados = [...new Set([...remover, ...processar])];
  await d.collection("arquivos").deleteMany({ repoId: repo._id, path: { $in: tocados } });
  await d.collection("chunks").deleteMany({ repoId: repo._id, path: { $in: tocados } });

  /** @type {import("../tipos.js").Arquivo[]} */
  const arquivos = [];
  /** @type {ChunkBruto[]} */
  const brutos = [];
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

/**
 * Decide o destino de um arquivo: ignorado (com motivo), erro ou indexado
 * (com seus chunks). Os filtros vão do mais barato ao mais caro: caminho,
 * tipo no disco, tamanho/binário, segredo e, por fim, o chunking.
 * @param {string} repoId @param {string} dir @param {string} p
 * @returns {Promise<{ arquivo: import("../tipos.js").Arquivo, chunks: ChunkBruto[] }>}
 */
async function processarArquivo(repoId, dir, p) {
  /** @type {import("../tipos.js").Arquivo} */
  const base = {
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

  // Caminho com "../" sairia do clone. Não deveria acontecer com ls-files, mas custa uma linha.
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
    return { arquivo: { ...base, status: "erro", motivo: String(/** @type {Error} */ (e).message).slice(0, 200) }, chunks: [] };
  }
}

// Embedding é reaproveitado pelo hash do TEXTO EMBEDADO (cabeçalho + conteúdo),
// não pela posição: mover uma função de linha não gera embedding novo.
// Em repositório grande isso é a diferença entre segundos e minutos (e dinheiro,
// quando o embedding é pago por token).
/** @param {ChunkBruto} c */
function textoEmbedado(c) {
  return `${c.cabecalho}\n${c.conteudo}`;
}

/**
 * hashTexto -> embedding dos chunks que já estão no banco.
 * @param {Repositorio} repo
 */
async function cacheEmbeddings(repo) {
  /** @type {Map<string, number[]>} */
  const m = new Map();
  if (repo.embedModelo !== modeloEmbedding()) return m;
  const cur = (await db()).collection("chunks").find({ repoId: repo._id }, { projection: { hashTexto: 1, embedding: 1 } });
  for await (const c of cur) m.set(c.hashTexto, c.embedding);
  return m;
}

/**
 * Gera embedding só para os textos que ainda não estão no cache, em lotes,
 * e monta os documentos finais de chunk.
 * O hash inclui o nome do modelo: trocar de modelo invalida tudo.
 * @param {Repositorio} repo @param {ChunkBruto[]} brutos @param {string} sha
 * @param {Map<string, number[]>} cache @param {Estatisticas} est
 * @returns {Promise<import("../tipos.js").Chunk[]>}
 */
async function embeddar(repo, brutos, sha, cache, est) {
  const modelo = modeloEmbedding();
  const hashes = brutos.map((c) => createHash("sha256").update(modelo).update("\0").update(textoEmbedado(c)).digest("hex"));
  const faltando = [...new Set(hashes.filter((h) => !cache.has(h)))];
  const textoPorHash = new Map(brutos.map((c, i) => [hashes[i], textoEmbedado(c)]));

  const LOTE = 32;
  for (let i = 0; i < faltando.length; i += LOTE) {
    const lote = faltando.slice(i, i + LOTE);
    const vetores = await embedDocumentos(lote.map((h) => /** @type {string} */ (textoPorHash.get(h))));
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
    embedding: /** @type {number[]} */ (cache.get(hashes[i])),
    tokens: tokenizar(`${c.simbolo ?? ""} ${c.path} ${c.conteudo}`),
    referencias: c.referencias,
    criadoEm: t,
    atualizadoEm: t,
  }));
}

/** @param {string} colecao @param {object[]} docs */
async function inserirEmLotes(colecao, docs) {
  const col = (await db()).collection(colecao);
  for (let i = 0; i < docs.length; i += 500) {
    const lote = docs.slice(i, i + 500);
    if (lote.length) await col.insertMany(/** @type {any[]} */ (lote), { ordered: false });
  }
}

// Progresso gravado no próprio repositório: a tela de repositórios lê e mostra a barra.
/** @param {string} repoId @param {string} etapa @param {number} processados @param {number} total */
async function progresso(repoId, etapa, processados, total) {
  await (await db()).collection("repositorios").updateOne({ _id: repoId }, { $set: { progresso: { etapa, processados, total } } });
}

/**
 * Apaga índice e clone. Usado quando o repo é removido ou muda de branch.
 * @param {string} repoId
 */
export async function limparRepo(repoId) {
  const d = await db();
  await d.collection("chunks").deleteMany({ repoId });
  await d.collection("arquivos").deleteMany({ repoId });
  await rm(dirRepo(repoId), { recursive: true, force: true });
}
