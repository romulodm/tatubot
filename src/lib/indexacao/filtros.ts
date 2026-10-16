import path from "node:path";

const DIRS_IGNORADOS = new Set(["node_modules", "dist", "build", ".git", ".next", "out", "coverage", "vendor", "target", "__pycache__", ".venv", ".turbo"]);
const LOCKFILES = new Set(["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb", "Cargo.lock", "poetry.lock", "composer.lock", "Gemfile.lock", "go.sum"]);
const EXT_BINARIAS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".pdf", ".zip", ".gz", ".tgz", ".tar", ".7z", ".rar",
  ".woff", ".woff2", ".ttf", ".otf", ".eot", ".mp3", ".mp4", ".mov", ".webm", ".wav", ".exe", ".dll", ".so", ".dylib",
  ".class", ".jar", ".wasm", ".bin", ".psd", ".sqlite", ".db",
]);
const MINIFICADO = /\.min\.(js|css)$|\.map$/;

// Decisão por caminho, antes de ler o arquivo.
export function motivoIgnorarCaminho(p: string): string | null {
  const partes = p.split("/");
  if (partes.slice(0, -1).some((d) => DIRS_IGNORADOS.has(d))) return "diretorio_ignorado";
  const nome = partes[partes.length - 1];
  if (LOCKFILES.has(nome)) return "lockfile";
  if (MINIFICADO.test(nome)) return "minificado";
  if (EXT_BINARIAS.has(path.extname(nome).toLowerCase())) return "binario";
  return null;
}

// Decisão pelo conteúdo: tamanho e byte nulo nos primeiros 8 KB.
export function motivoIgnorarConteudo(buf: Buffer, maxBytes: number): string | null {
  if (buf.length > maxBytes) return "grande_demais";
  if (buf.subarray(0, 8192).includes(0)) return "binario";
  return null;
}

export function linguagem(p: string): string {
  const ext = path.extname(p).toLowerCase();
  const mapa: Record<string, string> = {
    ".ts": "typescript", ".tsx": "typescript", ".mts": "typescript", ".cts": "typescript",
    ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript", ".cjs": "javascript",
    ".md": "markdown", ".mdx": "markdown", ".py": "python", ".go": "go", ".rs": "rust",
    ".java": "java", ".kt": "kotlin", ".rb": "ruby", ".php": "php", ".cs": "csharp",
    ".c": "c", ".h": "c", ".cpp": "cpp", ".hpp": "cpp", ".json": "json", ".yml": "yaml",
    ".yaml": "yaml", ".toml": "toml", ".sql": "sql", ".sh": "shell", ".css": "css", ".scss": "css",
    ".html": "html", ".vue": "vue", ".svelte": "svelte", ".prisma": "prisma",
  };
  return mapa[ext] ?? "texto";
}
