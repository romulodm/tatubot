// Leitura centralizada das variáveis de ambiente, com padrões de desenvolvimento.
function env(nome: string, padrao = ""): string {
  return process.env[nome] ?? padrao;
}

export const config = {
  mongoUri: env("MONGODB_URI", "mongodb://localhost:27017"),
  mongoDb: env("MONGODB_DB", "repobot"),
  jwtSecret: env("JWT_SECRET", "dev-inseguro-troque-em-producao-0123456789abcdef"),
  jwtIssuer: env("JWT_ISSUER", "repobot"),
  jwtAudience: env("JWT_AUDIENCE", "repobot-web"),
  accessTtlMin: Number(env("JWT_ACCESS_TTL_MIN", "15")),
  refreshTtlDias: Number(env("REFRESH_TTL_DIAS", "7")),
  reposDir: env("REPOS_DIR", "./data/repos"),
  workerMode: env("WORKER_MODE", "inline") as "inline" | "off",
  llm: {
    provider: env("LLM_PROVIDER", "local") as "local" | "openai_compat",
    baseUrl: env("LLM_BASE_URL", "http://localhost:11434/v1").replace(/\/$/, ""),
    apiKey: env("LLM_API_KEY", "ollama"),
    chatModel: env("LLM_CHAT_MODEL", "qwen2.5:7b"),
    embedModel: env("LLM_EMBED_MODEL", ""),
    prefixoDoc: env("EMBED_PREFIX_DOC", ""),
    prefixoConsulta: env("EMBED_PREFIX_QUERY", ""),
  },
  limites: {
    arquivoMaxBytes: 200 * 1024,
    arquivosPorRepo: 4000,
    agentePassos: 12,
    agenteTokensEntrada: 60_000,
    agenteTempoMs: 120_000,
  },
};
