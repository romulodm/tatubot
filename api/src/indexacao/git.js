import { spawn } from "node:child_process";
import { ErroPermanente, ErroTransitorio } from "../erros.js";

// sempre spawn sem shell e sem prompt de senha: repo privado falha na hora
export function git(args, cwd, timeoutMs = 120_000) {
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
      reject(Object.assign(new Error(err.trim() || `git ${args[0]} saiu com código ${code}`), { code }));
    });
  });
}

// repo/branch que não existe vai direto para a DLQ; o resto tenta de novo
function classificar(e) {
  const m = e.message;
  if (/not found|Repository not found|could not read Username|Remote branch .* not found|couldn't find remote ref/i.test(m)) {
    return new ErroPermanente("REPO_INACESSIVEL", "Repositório ou branch não encontrado (só repositórios públicos são suportados)");
  }
  return new ErroTransitorio(m);
}

export async function clonar(url, branch, destino) {
  const args = ["clone", "--depth", "50", "--single-branch", ...(branch ? ["--branch", branch] : []), "--", url, destino];
  try {
    await git(args, undefined, 300_000);
  } catch (e) {
    throw classificar(e);
  }
  return (await git(["rev-parse", "--abbrev-ref", "HEAD"], destino)).trim();
}

export async function buscarAtualizacao(dir, branch) {
  try {
    await git(["fetch", "--depth", "50", "origin", branch], dir, 300_000);
  } catch (e) {
    throw classificar(e);
  }
  return (await git(["rev-parse", "FETCH_HEAD"], dir)).trim();
}

export async function checkout(dir, ref) {
  await git(["reset", "--hard", "--quiet", ref], dir);
}

export async function head(dir) {
  return (await git(["rev-parse", "HEAD"], dir)).trim();
}

export async function ehAncestral(dir, antigo, novo) {
  try {
    await git(["merge-base", "--is-ancestor", antigo, novo], dir);
    return true;
  } catch {
    return false;
  }
}

export async function diff(dir, antigo, novo) {
  const out = await git(["diff", "--name-status", "-M", "-z", antigo, novo], dir);
  const partes = out.split("\0").filter(Boolean);
  const r = [];
  for (let i = 0; i < partes.length;) {
    const s = partes[i++];
    if (s.startsWith("R")) {
      r.push({ status: "R", antigo: partes[i++], path: partes[i++] });
    } else if (s === "A" || s === "M" || s === "D") {
      r.push({ status: s, path: partes[i++] });
    } else {
      if (s.startsWith("C")) i++;
      r.push({ status: "M", path: partes[i++] });
    }
  }
  return r;
}

export async function listarArquivos(dir) {
  const out = await git(["ls-files", "-z"], dir);
  return out.split("\0").filter(Boolean);
}
