// Varredura de segredos ANTES de qualquer chunk: arquivo suspeito é ignorado
// por inteiro, então o segredo nunca chega a embedding, prompt ou resposta.
const NOMES = [/^\.env(\..+)?$/i, /\.pem$/i, /\.key$/i, /^id_(rsa|dsa|ecdsa|ed25519)$/, /\.p12$/i, /\.pfx$/i, /^credentials(\.json)?$/i];
const EXEMPLO = /\.(example|sample|template|dist)$/i;

const PADROES: [string, RegExp][] = [
  ["chave_privada", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["github_token", /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{60,}\b/],
  ["openai_key", /\bsk-(proj-)?[A-Za-z0-9_-]{32,}\b/],
  ["aws_access_key", /\bAKIA[0-9A-Z]{16}\b/],
  ["slack_token", /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/],
  ["google_api_key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["stripe_key", /\b[rs]k_live_[0-9A-Za-z]{24,}\b/],
  ["url_com_senha", /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s:@/]{6,}@[^\s/]+/i],
];

export function detectarSegredo(path: string, conteudo: string): string | null {
  const nome = path.split("/").pop() ?? path;
  if (!EXEMPLO.test(nome) && NOMES.some((r) => r.test(nome))) return "arquivo_sensivel";
  for (const [tipo, r] of PADROES) {
    if (r.test(conteudo)) {
      // URL com senha de exemplo ("user:password@localhost") é comum em docs;
      // ignoramos as triviais para não descartar READMEs inteiros.
      if (tipo === "url_com_senha" && /:(pass(word)?|senha|secret|changeme|example|postgres|root|guest)@/i.test(conteudo.match(r)![0])) continue;
      return tipo;
    }
  }
  return null;
}
