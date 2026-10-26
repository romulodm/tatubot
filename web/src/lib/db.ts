import { MongoClient, type Db } from "mongodb";

function env(nome: string, padrao = ""): string {
  const v = process.env[nome];
  return v === undefined || v === "" ? padrao : v;
}

export const config = {
  mongoUri: env("MONGODB_URI", "mongodb://localhost:27017"),
  mongoDb: env("MONGODB_DB", "tatubot"),
  jwt: {
    issuer: env("JWT_ISSUER", "tatubot"),
    audience: env("JWT_AUDIENCE", "tatubot-web"),
    accessTtlMin: Number(env("JWT_ACCESS_TTL_MIN", "15")),
    chavePrivadaPath: env("JWT_PRIVATE_KEY_PATH", "./data/chaves/jwt-privada.pem"),
  },
  refreshTtlDias: Number(env("REFRESH_TTL_DIAS", "7")),
};

// O web só mexe em `usuarios` e `refresh_tokens`; o resto do banco é da api.

export type Papel = "admin" | "usuario";

export interface Usuario {
  _id: string;
  nome: string;
  email: string;
  senhaHash: string;
  papel: Papel;
  criadoEm: Date;
  atualizadoEm: Date;
}

export interface RefreshToken {
  _id: string;
  usuarioId: string;
  familia: string;
  tokenHash: string;
  expiraEm: Date;
  revogadoEm: Date | null;
  substituidoPor: string | null;
  criadoEm: Date;
}

// no dev o Next recarrega os módulos; o globalThis segura a conexão entre recargas
const g = globalThis as unknown as { _mongo?: Promise<MongoClient>; _indices?: Promise<void> };

export async function db(): Promise<Db> {
  if (!g._mongo) {
    g._mongo = new MongoClient(config.mongoUri, { maxPoolSize: 20 }).connect();
    g._mongo.catch(() => (g._mongo = undefined));
  }
  const d = (await g._mongo).db(config.mongoDb);
  if (!g._indices) {
    g._indices = criarIndices(d);
    g._indices.catch(() => (g._indices = undefined));
  }
  await g._indices;
  return d;
}

async function criarIndices(d: Db) {
  await Promise.all([
    d.collection("usuarios").createIndex({ email: 1 }, { unique: true }),
    d.collection("refresh_tokens").createIndex({ tokenHash: 1 }, { unique: true }),
    d.collection("refresh_tokens").createIndex({ usuarioId: 1 }),
  ]);
}

export const agora = () => new Date();
