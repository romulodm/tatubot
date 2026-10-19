// Leitura centralizada das variáveis de ambiente.
//
// Regra da casa: nenhum outro arquivo lê process.env direto. Assim dá pra ver
// num lugar só tudo o que o serviço aceita de configuração (e o .env.example
// na raiz do repositório espelha esta lista).

/**
 * Lê uma variável de ambiente com valor padrão.
 * @param {string} nome
 * @param {string} [padrao]
 */
function env(nome, padrao = "") {
  const v = process.env[nome];
  return v === undefined || v === "" ? padrao : v;
}

const apiKey = env("LLM_API_KEY");

// Sem LLM_PROVIDER explícito: se tem chave, usa a API compatível com OpenAI;
// se não tem, cai no modo local (extrativo), que funciona sem rede nenhuma.
const provider = /** @type {"local" | "openai_compat"} */ (env("LLM_PROVIDER", apiKey ? "openai_compat" : "local"));

function modeloDeEmbedding() {
  const v = env("LLM_EMBED_MODEL", provider === "openai_compat" ? "text-embedding-3-small" : "");
  return v === "local" ? "" : v;
}

export const config = {
  porta: Number(env("PORTA", "4000")),
  ambiente: env("NODE_ENV", "development"),

  mongoUri: env("MONGODB_URI", "mongodb://localhost:27017"),
  mongoDb: env("MONGODB_DB", "tatubot"),

  // O token é emitido pelo web (Next). Aqui só verificamos, com a chave
  // pública que o web publica em /.well-known/jwks.json.
  jwt: {
    jwksUrl: env("JWKS_URL", "http://localhost:3000/.well-known/jwks.json"),
    issuer: env("JWT_ISSUER", "tatubot"),
    audience: env("JWT_AUDIENCE", "tatubot-web"),
  },

  // Origens que podem fazer mutações (POST/PATCH/DELETE) com cookie.
  // Defesa extra contra CSRF, além do SameSite=Lax do cookie.
  origensPermitidas: env("WEB_ORIGIN", "http://localhost:3000")
    .split(",")
    .map((o) => o.trim().replace(/\/$/, ""))
    .filter(Boolean),

  reposDir: env("REPOS_DIR", "./data/repos"),

  // inline: o worker da fila roda no mesmo processo da API (bom para dev).
  // off: rode `npm run worker` em outro processo (é o que o docker compose faz).
  workerMode: /** @type {"inline" | "off"} */ (env("WORKER_MODE", "inline")),

  llm: {
    provider,
    baseUrl: env("LLM_BASE_URL", "https://api.openai.com/v1").replace(/\/$/, ""),
    apiKey,
    chatModel: env("LLM_CHAT_MODEL", "gpt-4.1-mini"),
    // Vazio = text-embedding-3-small quando há LLM. "local" força o embedding
    // local (hashing de termos, sem rede), útil com provedores sem /embeddings.
    embedModel: modeloDeEmbedding(),
    // Prefixos exigidos por alguns modelos (ex.: nomic-embed-text no Ollama).
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
