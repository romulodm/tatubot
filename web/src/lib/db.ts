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

// O web é dono só de `usuarios` e `refresh_tokens`. As outras coleções
// (repositórios, bots, conversas, índice do RAG, fila) são do microsserviço
// api/, que cria os próprios índices.
async function criarIndices(d: Db) {
  await Promise.all([
    d.collection("usuarios").createIndex({ email: 1 }, { unique: true }),
    d.collection("refresh_tokens").createIndex({ tokenHash: 1 }, { unique: true }),
    d.collection("refresh_tokens").createIndex({ usuarioId: 1 }),
  ]);
}

export function agora() {
  return new Date();
}
