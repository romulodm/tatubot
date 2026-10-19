// Leitura centralizada das variáveis de ambiente do web.
//
// O web (Next) cuida só de páginas e autenticação. Tudo de repositórios,
// bots, conversas e RAG mora no microsserviço `api/`, que recebe /api/* por
// rewrite (ver next.config.ts).
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
    // Par RSA usado para assinar o access token. Se o arquivo não existir,
    // é gerado no primeiro boot (ver lib/auth/chaves.ts). NUNCA commitar.
    chavePrivadaPath: env("JWT_PRIVATE_KEY_PATH", "./data/chaves/jwt-privada.pem"),
  },
  refreshTtlDias: Number(env("REFRESH_TTL_DIAS", "7")),
};
