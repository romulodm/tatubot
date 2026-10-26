function env(nome, padrao = "") {
  const v = process.env[nome];
  return v === undefined || v === "" ? padrao : v;
}

const apiKey = env("LLM_API_KEY");
// sem chave e sem LLM_PROVIDER, roda no modo local (respostas extrativas)
const provider = env("LLM_PROVIDER", apiKey ? "openai_compat" : "local");

let embedModel = env("LLM_EMBED_MODEL", provider === "openai_compat" ? "text-embedding-3-small" : "");
if (embedModel === "local") embedModel = "";

export const config = {
  porta: Number(env("PORTA", "4000")),
  mongoUri: env("MONGODB_URI", "mongodb://localhost:27017"),
  mongoDb: env("MONGODB_DB", "tatubot"),
  reposDir: env("REPOS_DIR", "./data/repos"),
  // inline = worker no mesmo processo da api; off = rodar `npm run worker` à parte
  workerMode: env("WORKER_MODE", "inline"),

  jwt: {
    jwksUrl: env("JWKS_URL", "http://localhost:3000/.well-known/jwks.json"),
    issuer: env("JWT_ISSUER", "tatubot"),
    audience: env("JWT_AUDIENCE", "tatubot-web"),
  },

  origensPermitidas: env("WEB_ORIGIN", "http://localhost:3000")
    .split(",")
    .map((o) => o.trim().replace(/\/$/, ""))
    .filter(Boolean),

  llm: {
    provider,
    apiKey,
    baseUrl: env("LLM_BASE_URL", "https://api.openai.com/v1").replace(/\/$/, ""),
    chatModel: env("LLM_CHAT_MODEL", "gpt-4.1-mini"),
    embedModel,
    prefixoDoc: env("EMBED_PREFIX_DOC"),
    prefixoConsulta: env("EMBED_PREFIX_QUERY"),
  },

  limites: {
    arquivoMaxBytes: 200 * 1024,
    arquivosPorRepo: 4000,
    agentePassos: 12,
    agenteTokensEntrada: 60_000,
    agenteTempoMs: 120_000,
  },
};

export function log(nivel, msg, campos = {}) {
  const linha = JSON.stringify({ nivel, msg, servico: "tatubot-api", em: new Date().toISOString(), ...campos });
  if (nivel === "erro") console.error(linha);
  else console.log(linha);
}
