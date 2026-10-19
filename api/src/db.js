import { MongoClient } from "mongodb";
import { config } from "./config.js";

// Conexão única com o Mongo, criada na primeira chamada e reaproveitada.
//
// Fronteira entre serviços: o web (Next) é dono de `usuarios` e
// `refresh_tokens`; este serviço nunca lê nem escreve nessas coleções.
// Tudo o que ele precisa saber do usuário vem nas claims do JWT.

/** @type {Promise<MongoClient> | undefined} */
let conexao;
/** @type {Promise<void> | undefined} */
let indices;

export function cliente() {
  if (!conexao) {
    conexao = new MongoClient(config.mongoUri, { maxPoolSize: 20 }).connect();
    // Se a conexão falhar, esquece a promise para a próxima chamada tentar de novo.
    conexao.catch(() => (conexao = undefined));
  }
  return conexao;
}

/** @returns {Promise<import("mongodb").Db>} */
export async function db() {
  const c = await cliente();
  const d = c.db(config.mongoDb);
  if (!indices) {
    indices = criarIndices(d);
    indices.catch(() => (indices = undefined));
  }
  await indices;
  return d;
}

export async function fechar() {
  if (conexao) await (await conexao).close();
  conexao = undefined;
  indices = undefined;
}

// Índices fazem o papel das constraints do schema SQL do context.md
// (unicidade) e deixam as consultas mais comuns rápidas.
/** @param {import("mongodb").Db} d */
async function criarIndices(d) {
  await Promise.all([
    d.collection("repositorios").createIndex({ ownerId: 1, ghOwner: 1, ghNome: 1, branch: 1 }, { unique: true }),
    d.collection("arquivos").createIndex({ repoId: 1, path: 1 }, { unique: true }),
    d.collection("chunks").createIndex({ repoId: 1, path: 1 }),
    d.collection("chunks").createIndex({ repoId: 1, hashTexto: 1 }),
    d.collection("bots").createIndex({ ownerId: 1 }),
    d.collection("conversas").createIndex({ usuarioId: 1, atualizadoEm: -1 }),
    d.collection("mensagens").createIndex({ conversaId: 1, criadoEm: 1 }),
    d.collection("eventos").createIndex({ status: 1, disponivelEm: 1 }),
    d.collection("eventos_processados").createIndex({ eventId: 1, consumidor: 1 }, { unique: true }),
    d.collection("execucoes").createIndex({ mensagemId: 1 }),
  ]);
}

export function agora() {
  return new Date();
}
