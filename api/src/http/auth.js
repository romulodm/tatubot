import { verify } from "node:crypto";
import { config } from "../config.js";
import { naoAutorizado } from "../erros.js";
import { chavePorKid } from "./jwks.js";

// Verificação de JWT escrita à mão (é o "exercício central" do context.md).
//
// Um JWT é: base64url(cabeçalho) . base64url(claims) . base64url(assinatura)
// A assinatura cobre exatamente o texto "cabeçalho.claims". Então:
//   1. separar as três partes;
//   2. ler o cabeçalho e EXIGIR alg = RS256 (lista fechada: "none" e "HS256"
//      são os dois ataques clássicos de confusão de algoritmo);
//   3. achar a chave pública pelo kid;
//   4. verificar a assinatura com crypto.verify;
//   5. só depois confiar nas claims: exp, nbf, iss, aud, sub.

/** Nome do cookie httpOnly gravado pelo web no login. */
export const COOKIE_ACCESS = "rb_access";

const FOLGA_RELOGIO_S = 30; // tolerância para relógios levemente dessincronizados

/**
 * @typedef {{ ok: true, usuario: import("../tipos.js").Usuario } | { ok: false, motivo: string }} ResultadoJwt
 */

/**
 * @param {string} token
 * @returns {Promise<ResultadoJwt>}
 */
export async function verificarJwt(token) {
  const partes = token.split(".");
  if (partes.length !== 3) return { ok: false, motivo: "formato" };
  const [cab64, claims64, assinatura64] = partes;

  let cabecalho;
  let claims;
  try {
    cabecalho = JSON.parse(Buffer.from(cab64, "base64url").toString("utf8"));
    claims = JSON.parse(Buffer.from(claims64, "base64url").toString("utf8"));
  } catch {
    return { ok: false, motivo: "formato" };
  }

  if (cabecalho.alg !== "RS256") return { ok: false, motivo: "alg" };
  if (typeof cabecalho.kid !== "string") return { ok: false, motivo: "kid" };

  const chave = await chavePorKid(cabecalho.kid);
  if (!chave) return { ok: false, motivo: "kid" };

  const valida = verify("RSA-SHA256", Buffer.from(`${cab64}.${claims64}`), chave, Buffer.from(assinatura64, "base64url"));
  if (!valida) return { ok: false, motivo: "assinatura" };

  const agora = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== "number" || claims.exp + FOLGA_RELOGIO_S < agora) return { ok: false, motivo: "expirado" };
  if (typeof claims.nbf === "number" && claims.nbf - FOLGA_RELOGIO_S > agora) return { ok: false, motivo: "nbf" };
  if (claims.iss !== config.jwt.issuer) return { ok: false, motivo: "iss" };
  const audiencias = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiencias.includes(config.jwt.audience)) return { ok: false, motivo: "aud" };
  if (typeof claims.sub !== "string" || !claims.sub) return { ok: false, motivo: "sub" };

  const papel = claims.papel === "admin" ? "admin" : "usuario";
  return { ok: true, usuario: { sub: claims.sub, papel, nome: String(claims.nome ?? "") } };
}

/**
 * Lê os cookies do header sem biblioteca: "a=1; b=2" -> { a: "1", b: "2" }.
 * @param {string | undefined} header
 */
export function lerCookies(header) {
  /** @type {Record<string, string>} */
  const r = {};
  for (const par of (header ?? "").split(";")) {
    const i = par.indexOf("=");
    if (i < 0) continue;
    const nome = par.slice(0, i).trim();
    if (!nome) continue;
    try {
      r[nome] = decodeURIComponent(par.slice(i + 1).trim());
    } catch {
      r[nome] = par.slice(i + 1).trim();
    }
  }
  return r;
}

/**
 * O token pode vir do cookie (navegador) ou do header Authorization
 * (curl, testes, outro serviço). Nunca da query string: URL vai parar em
 * log de proxy e no histórico do navegador.
 * @param {import("node:http").IncomingMessage} req
 */
function tokenDa(req) {
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  return lerCookies(req.headers.cookie)[COOKIE_ACCESS] ?? null;
}

/**
 * Exige um usuário autenticado; 401 caso contrário.
 * O front, ao receber 401, chama /api/auth/refresh no web e tenta de novo.
 * @param {import("node:http").IncomingMessage} req
 * @returns {Promise<import("../tipos.js").Usuario>}
 */
export async function exigirUsuario(req) {
  const token = tokenDa(req);
  if (!token) throw naoAutorizado();
  const r = await verificarJwt(token);
  if (!r.ok) throw naoAutorizado();
  return r.usuario;
}

/**
 * Filtro de dono para as consultas: admin vê tudo; usuário comum só o seu.
 * Recurso alheio vira 404 nas rotas (não revelar que existe).
 * @param {import("../tipos.js").Usuario} u
 * @param {string} [campo]
 * @returns {Record<string, string>}
 */
export function filtroDono(u, campo = "ownerId") {
  return u.papel === "admin" ? {} : { [campo]: u.sub };
}
