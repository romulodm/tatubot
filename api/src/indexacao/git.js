import { spawn } from "node:child_process";
import { ErroPermanente, ErroTransitorio } from "../erros.js";

// Tudo o que a indexação precisa do git, sem biblioteca: só o binário.
//
// git sempre via spawn com lista de argumentos e SEM shell. A URL e a branch
// vão como argumentos separados, nunca concatenadas num comando, então uma
// branch chamada "main; rm -rf /" é só um nome de branch esquisito.
// O "--" antes da URL impede que ela seja lida como opção ("--upload-pack=...").

/**
 * @param {string[]} args
 * @param {string} [cwd]
 * @param {number} [timeoutMs]
 * @returns {Promise<string>} stdout
 */
export function git(args, cwd, timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    const p = spawn("git", args, {
      cwd,
      shell: false,
      // Nunca pedir usuário/senha no terminal: repositório privado falha na hora.
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

/**
 * Classifica falhas de rede do git. Repositório ou branch inexistente não
 * adianta tentar de novo (vai direto para a DLQ); o resto pode ser rede.
 * @param {Error} e
 */
function classificar(e) {
  const m = e.message;
  if (/not found|Repository not found|could not read Username|Remote branch .* not found|couldn't find remote ref/i.test(m)) {
    return new ErroPermanente("REPO_INACESSIVEL", "Repositório ou branch não encontrado (só repositórios públicos são suportados)");
  }
  return new ErroTransitorio(m);
}

/**
 * Clone raso (só os últimos 50 commits): é o suficiente para o diff
 * incremental e evita baixar anos de histórico.
 * @param {string} url
 * @param {string} branch vazia = branch padrão do repositório (main, master, trunk...)
 * @param {string} destino
 * @returns {Promise<string>} a branch que ficou em uso
 */
export async function clonar(url, branch, destino) {
  const args = ["clone", "--depth", "50", "--single-branch", ...(branch ? ["--branch", branch] : []), "--", url, destino];
  try {
    await git(args, undefined, 300_000);
  } catch (e) {
    throw classificar(/** @type {Error} */ (e));
  }
  return (await git(["rev-parse", "--abbrev-ref", "HEAD"], destino)).trim();
}

/**
 * Baixa os commits novos sem mexer na cópia de trabalho.
 * @param {string} dir
 * @param {string} branch
 * @returns {Promise<string>} sha do commit mais novo da branch remota
 */
export async function buscarAtualizacao(dir, branch) {
  try {
    await git(["fetch", "--depth", "50", "origin", branch], dir, 300_000);
  } catch (e) {
    throw classificar(/** @type {Error} */ (e));
  }
  return (await git(["rev-parse", "FETCH_HEAD"], dir)).trim();
}

/** @param {string} dir @param {string} ref */
export async function checkout(dir, ref) {
  await git(["reset", "--hard", "--quiet", ref], dir);
}

/** @param {string} dir */
export async function head(dir) {
  return (await git(["rev-parse", "HEAD"], dir)).trim();
}

/**
 * O commit antigo ainda está no histórico do novo? Se não está, houve force
 * push e o diff não faz sentido: reindexa tudo.
 * @param {string} dir @param {string} antigo @param {string} novo
 */
export async function ehAncestral(dir, antigo, novo) {
  try {
    await git(["merge-base", "--is-ancestor", antigo, novo], dir);
    return true;
  } catch {
    return false; // código 1 = não é ancestral; outros (commit fora do clone raso) tratamos igual
  }
}

/**
 * @typedef {object} Mudanca
 * @property {"A" | "M" | "D" | "R"} status adicionado, modificado, removido, renomeado
 * @property {string} path
 * @property {string} [antigo] caminho anterior, quando renomeado
 */

/**
 * Lista o que mudou entre dois commits.
 * @param {string} dir @param {string} antigo @param {string} novo
 * @returns {Promise<Mudanca[]>}
 */
export async function diff(dir, antigo, novo) {
  // -M explícito: renomeações detectadas independentemente da config do git local.
  // -z: separa por \0, então nomes com espaço ou acento não quebram o parse.
  const out = await git(["diff", "--name-status", "-M", "-z", antigo, novo], dir);
  const partes = out.split("\0").filter(Boolean);
  /** @type {Mudanca[]} */
  const r = [];
  for (let i = 0; i < partes.length;) {
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

/**
 * Só arquivos rastreados: isso já respeita o .gitignore do repositório sem
 * precisar reimplementar o parser dele.
 * @param {string} dir
 */
export async function listarArquivos(dir) {
  const out = await git(["ls-files", "-z"], dir);
  return out.split("\0").filter(Boolean);
}
