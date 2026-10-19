// Varredura de segredos ANTES de qualquer chunk.
//
// Se um arquivo parece ter segredo, ele é ignorado por inteiro: nunca vira
// chunk, embedding, trecho no prompt ou resposta. É mais seguro perder um
// arquivo do que mandar uma chave de produção para um LLM.

// Arquivos sensíveis pelo nome. Variações de exemplo (.env.example) passam.
const NOMES = [/^\.env(\..+)?$/i, /\.pem$/i, /\.key$/i, /^id_(rsa|dsa|ecdsa|ed25519)$/, /\.p12$/i, /\.pfx$/i, /^credentials(\.json)?$/i];
const EXEMPLO = /\.(example|sample|template|dist)$/i;

// Padrões conhecidos de tokens no conteúdo.
/** @type {[string, RegExp][]} */
const PADROES = [
  ["chave_privada", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["github_token", /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{60,}\b/],
  ["openai_key", /\bsk-(proj-)?[A-Za-z0-9_-]{32,}\b/],
  ["aws_access_key", /\bAKIA[0-9A-Z]{16}\b/],
  ["slack_token", /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/],
  ["google_api_key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["stripe_key", /\b[rs]k_live_[0-9A-Za-z]{24,}\b/],
  ["url_com_senha", /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s:@/]{6,}@[^\s/]+/i],
];

/**
 * @param {string} path caminho do arquivo no repositório
 * @param {string} conteudo
 * @returns {string | null} tipo do segredo encontrado, ou null
 */
export function detectarSegredo(path, conteudo) {
  const nome = path.split("/").pop() ?? path;
  if (!EXEMPLO.test(nome) && NOMES.some((r) => r.test(nome))) return "arquivo_sensivel";
  for (const [tipo, r] of PADROES) {
    const achado = conteudo.match(r);
    if (!achado) continue;
    // URL com senha de exemplo ("user:password@localhost") é comum em docs;
    // ignoramos as triviais para não descartar READMEs inteiros.
    if (tipo === "url_com_senha" && /:(pass(word)?|senha|secret|changeme|example|postgres|root|guest)@/i.test(achado[0])) continue;
    return tipo;
  }
  return null;
}
