import path from "node:path";

// Primeiro filtro da indexação: o que NÃO vale a pena ler.
// Dependências, lockfiles, binários e minificados só fariam barulho na busca
// (e gastariam embedding à toa). Ver docs/rag/02-indexacao.md.

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

/**
 * Decisão pelo caminho, antes de abrir o arquivo (barato).
 * @param {string} p caminho relativo à raiz do repositório
 * @returns {string | null} motivo para ignorar, ou null se pode seguir
 */
export function motivoIgnorarCaminho(p) {
  const partes = p.split("/");
  if (partes.slice(0, -1).some((d) => DIRS_IGNORADOS.has(d))) return "diretorio_ignorado";
  const nome = partes[partes.length - 1];
  if (LOCKFILES.has(nome)) return "lockfile";
  if (MINIFICADO.test(nome)) return "minificado";
  if (EXT_BINARIAS.has(path.extname(nome).toLowerCase())) return "binario";
  return null;
}

/**
 * Decisão pelo conteúdo: tamanho e byte nulo nos primeiros 8 KB
 * (texto de verdade não tem byte 0; é a mesma heurística que o git usa).
 * @param {Buffer} buf
 * @param {number} maxBytes
 */
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

/** @param {string} p */
export function linguagem(p) {
  return /** @type {Record<string, string>} */ (LINGUAGENS)[path.extname(p).toLowerCase()] ?? "texto";
}
