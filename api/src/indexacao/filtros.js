import path from "node:path";

// prettier-ignore
const DIRS_IGNORADOS = new Set(["node_modules", "dist", "build", ".git", ".next", "out", "coverage", "vendor", "target", "__pycache__", ".venv", ".turbo"]);
// prettier-ignore
const LOCKFILES = new Set(["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb", "Cargo.lock", "poetry.lock", "composer.lock", "Gemfile.lock", "go.sum"]);
// prettier-ignore
const EXT_BINARIAS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".pdf", ".zip", ".gz", ".tgz", ".tar", ".7z", ".rar",
  ".woff", ".woff2", ".ttf", ".otf", ".eot", ".mp3", ".mp4", ".mov", ".webm", ".wav", ".exe", ".dll", ".so", ".dylib",
  ".class", ".jar", ".wasm", ".bin", ".psd", ".sqlite", ".db",
]);
const MINIFICADO = /\.min\.(js|css)$|\.map$/;

export function motivoIgnorarCaminho(p) {
  const partes = p.split("/");
  if (partes.slice(0, -1).some((d) => DIRS_IGNORADOS.has(d))) return "diretorio_ignorado";
  const nome = partes[partes.length - 1];
  if (LOCKFILES.has(nome)) return "lockfile";
  if (MINIFICADO.test(nome)) return "minificado";
  if (EXT_BINARIAS.has(path.extname(nome).toLowerCase())) return "binario";
  return null;
}

export function motivoIgnorarConteudo(buf, maxBytes) {
  if (buf.length > maxBytes) return "grande_demais";
  if (buf.subarray(0, 8192).includes(0)) return "binario";
  return null;
}

// prettier-ignore
const LINGUAGENS = {
  ".ts": "typescript", ".tsx": "typescript", ".mts": "typescript", ".cts": "typescript",
  ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript", ".cjs": "javascript",
  ".md": "markdown", ".mdx": "markdown", ".py": "python", ".go": "go", ".rs": "rust",
  ".java": "java", ".kt": "kotlin", ".rb": "ruby", ".php": "php", ".cs": "csharp",
  ".c": "c", ".h": "c", ".cpp": "cpp", ".hpp": "cpp", ".json": "json", ".yml": "yaml",
  ".yaml": "yaml", ".toml": "toml", ".sql": "sql", ".sh": "shell", ".css": "css", ".scss": "css",
  ".html": "html", ".vue": "vue", ".svelte": "svelte", ".prisma": "prisma",
};

export function linguagem(p) {
  return LINGUAGENS[path.extname(p).toLowerCase()] ?? "texto";
}

// ---------- segredos ----------
// Arquivo com segredo não entra no índice (e nunca vai para o LLM).

const NOMES = [/^\.env(\..+)?$/i, /\.pem$/i, /\.key$/i, /^id_(rsa|dsa|ecdsa|ed25519)$/, /\.p12$/i, /\.pfx$/i, /^credentials(\.json)?$/i];
const EXEMPLO = /\.(example|sample|template|dist)$/i;

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

export function detectarSegredo(path, conteudo) {
  const nome = path.split("/").pop() ?? path;
  if (!EXEMPLO.test(nome) && NOMES.some((r) => r.test(nome))) return "arquivo_sensivel";
  for (const [tipo, r] of PADROES) {
    const achado = conteudo.match(r);
    if (!achado) continue;
    if (tipo === "url_com_senha" && /:(pass(word)?|senha|secret|changeme|example|postgres|root|guest)@/i.test(achado[0])) continue;
    return tipo;
  }
  return null;
}
