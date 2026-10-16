import { MongoClient, type Db } from "mongodb";
import { config } from "./config";

// Em dev o Next recarrega módulos; guardamos o cliente no globalThis
// para não abrir uma conexão nova a cada hot reload.
const g = globalThis as unknown as { _mongo?: Promise<MongoClient>; _indices?: Promise<void> };

export function cliente(): Promise<MongoClient> {
  if (!g._mongo) {
    g._mongo = new MongoClient(config.mongoUri, { maxPoolSize: 20 }).connect();
    g._mongo.catch(() => (g._mongo = undefined));
  }
  return g._mongo;
}

export async function db(): Promise<Db> {
  const c = await cliente();
  const d = c.db(config.mongoDb);
  if (!g._indices) {
    g._indices = criarIndices(d);
    g._indices.catch(() => (g._indices = undefined));
  }
  await g._indices;
  return d;
}

// Índices são o equivalente às constraints do schema SQL do context.md.
async function criarIndices(d: Db) {
  await Promise.all([
    d.collection("usuarios").createIndex({ email: 1 }, { unique: true }),
    d.collection("refresh_tokens").createIndex({ tokenHash: 1 }, { unique: true }),
    d.collection("refresh_tokens").createIndex({ usuarioId: 1 }),
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
