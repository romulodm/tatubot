import { spawn } from "node:child_process";
import { ErroPermanente, ErroTransitorio } from "../erros";

// git sempre via spawn com lista de argumentos e sem shell: a URL e a branch
// nunca são interpretadas como comando, mesmo que tenham caracteres estranhos.
export function git(args: string[], cwd?: string, timeoutMs = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn("git", args, {
      cwd,
      shell: false,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "true" },
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => {
      clearTimeout(timer);
      reject(new ErroTransitorio(`git indisponível: ${e.message}`));
    });
    p.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve(out);
      const e = Object.assign(new Error(err.trim() || `git ${args[0]} saiu com código ${code}`), { code });
      reject(e);
    });
  });
}

// Classifica falhas de clone: repositório/branch inexistente não adianta tentar de novo.
function classificar(e: Error): Error {
  const m = e.message;
  if (/not found|Repository not found|could not read Username|Remote branch .* not found|couldn't find remote ref/i.test(m)) {
    return new ErroPermanente("REPO_INACESSIVEL", "Repositório ou branch não encontrado (só repositórios públicos são suportados)");
  }
  return new ErroTransitorio(m);
}

// branch vazia = branch padrão do repositório (main, master, trunk...).
export async function clonar(url: string, branch: string, destino: string): Promise<string> {
  const args = ["clone", "--depth", "50", "--single-branch", ...(branch ? ["--branch", branch] : []), "--", url, destino];
  try {
    await git(args, undefined, 300_000);
  } catch (e) {
    throw classificar(e as Error);
  }
  return (await git(["rev-parse", "--abbrev-ref", "HEAD"], destino)).trim();
}

export async function buscarAtualizacao(dir: string, branch: string): Promise<string> {
  try {
    await git(["fetch", "--depth", "50", "origin", branch], dir, 300_000);
  } catch (e) {
    throw classificar(e as Error);
  }
  return (await git(["rev-parse", "FETCH_HEAD"], dir)).trim();
}

export async function checkout(dir: string, ref: string) {
  await git(["reset", "--hard", "--quiet", ref], dir);
}

export async function head(dir: string): Promise<string> {
  return (await git(["rev-parse", "HEAD"], dir)).trim();
}

export async function ehAncestral(dir: string, antigo: string, novo: string): Promise<boolean> {
  try {
    await git(["merge-base", "--is-ancestor", antigo, novo], dir);
    return true;
  } catch {
    return false; // código 1 = não é ancestral; outros (commit fora do clone raso) tratamos igual
  }
}

export interface Mudanca {
  status: "A" | "M" | "D" | "R";
  path: string;
  antigo?: string;
}

export async function diff(dir: string, antigo: string, novo: string): Promise<Mudanca[]> {
  // -M explícito: renomeações detectadas independentemente da config do git local.
  const out = await git(["diff", "--name-status", "-M", "-z", antigo, novo], dir);
  const partes = out.split("\0").filter(Boolean);
  const r: Mudanca[] = [];
  for (let i = 0; i < partes.length; ) {
    const s = partes[i++];
    if (s.startsWith("R")) {
      r.push({ status: "R", antigo: partes[i++], path: partes[i++] });
    } else if (s === "A" || s === "M" || s === "D") {
      r.push({ status: s, path: partes[i++] });
    } else {
      // C (cópia), T (tipo) etc.: tratamos como modificação do último caminho
      if (s.startsWith("C")) i++;
      r.push({ status: "M", path: partes[i++] });
    }
  }
  return r;
}

// Só arquivos rastreados: isso já respeita o .gitignore do repositório.
export async function listarArquivos(dir: string): Promise<string[]> {
  const out = await git(["ls-files", "-z"], dir);
  return out.split("\0").filter(Boolean);
}
