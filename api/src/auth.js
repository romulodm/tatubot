import { createPublicKey, verify } from "node:crypto";
import { config, log } from "./config.js";
import { naoAutorizado } from "./erros.js";

// O web assina o JWT com RS256 e publica a chave pública no JWKS.
// Aqui só verificamos: a api nunca tem como fabricar um token.

export const COOKIE_ACCESS = "rb_access";
const FOLGA_RELOGIO_S = 30;

const chaves = new Map();
let ultimaTentativa = 0;
let carregando = null;

export async function carregarJwks() {
  ultimaTentativa = Date.now();
  const res = await fetch(config.jwt.jwksUrl, { signal: AbortSignal.timeout(5_000) });
  if (!res.ok) throw new Error(`JWKS respondeu ${res.status}`);
  const { keys = [] } = await res.json();
  const novas = new Map();
  for (const jwk of keys) {
    if (jwk.kty !== "RSA" || !jwk.kid) continue;
    if ((jwk.use && jwk.use !== "sig") || (jwk.alg && jwk.alg !== "RS256")) continue;
    novas.set(jwk.kid, createPublicKey({ key: { kty: jwk.kty, n: jwk.n, e: jwk.e }, format: "jwk" }));
  }
  if (!novas.size) throw new Error("JWKS sem chaves RSA de assinatura");
  chaves.clear();
  for (const [kid, k] of novas) chaves.set(kid, k);
  log("info", "jwks carregado", { kids: [...chaves.keys()] });
}

// kid desconhecido recarrega o JWKS, no máximo 1x por minuto (5 s enquanto não
// há nenhuma chave), para um token com kid aleatório não virar DoS no web.
async function chavePorKid(kid) {
  if (chaves.has(kid)) return chaves.get(kid);
  const intervalo = chaves.size ? 60_000 : 5_000;
  if (Date.now() - ultimaTentativa >= intervalo) {
    carregando ??= carregarJwks()
      .catch((e) => log("aviso", "falha ao carregar o JWKS", { url: config.jwt.jwksUrl, erro: String(e.message ?? e) }))
      .finally(() => (carregando = null));
    await carregando;
  }
  return chaves.get(kid) ?? null;
}

// usado nos testes
export function registrarChave(kid, chave) {
  chaves.set(kid, chave);
  ultimaTentativa = Date.now();
}

export async function verificarJwt(token) {
  const partes = token.split(".");
  if (partes.length !== 3) return { ok: false, motivo: "formato" };
  const [cab64, claims64, assinatura64] = partes;

  let cabecalho, claims;
  try {
    cabecalho = JSON.parse(Buffer.from(cab64, "base64url").toString("utf8"));
    claims = JSON.parse(Buffer.from(claims64, "base64url").toString("utf8"));
  } catch {
    return { ok: false, motivo: "formato" };
  }

  // lista fechada: "none" e HS256 são os ataques clássicos de troca de algoritmo
  if (cabecalho.alg !== "RS256") return { ok: false, motivo: "alg" };
  if (typeof cabecalho.kid !== "string") return { ok: false, motivo: "kid" };
  const chave = await chavePorKid(cabecalho.kid);
  if (!chave) return { ok: false, motivo: "kid" };

  const assinatura = Buffer.from(assinatura64, "base64url");
  if (!verify("RSA-SHA256", Buffer.from(`${cab64}.${claims64}`), chave, assinatura)) {
    return { ok: false, motivo: "assinatura" };
  }

  const agora = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== "number" || claims.exp + FOLGA_RELOGIO_S < agora) return { ok: false, motivo: "expirado" };
  if (typeof claims.nbf === "number" && claims.nbf - FOLGA_RELOGIO_S > agora) return { ok: false, motivo: "nbf" };
  if (claims.iss !== config.jwt.issuer) return { ok: false, motivo: "iss" };
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(config.jwt.audience)) return { ok: false, motivo: "aud" };
  if (typeof claims.sub !== "string" || !claims.sub) return { ok: false, motivo: "sub" };

  return { ok: true, usuario: { sub: claims.sub, papel: claims.papel === "admin" ? "admin" : "usuario", nome: String(claims.nome ?? "") } };
}

export function lerCookies(header) {
  const r = {};
  for (const par of (header ?? "").split(";")) {
    const i = par.indexOf("=");
    if (i < 0) continue;
    const nome = par.slice(0, i).trim();
    if (!nome) continue;
    const valor = par.slice(i + 1).trim();
    try {
      r[nome] = decodeURIComponent(valor);
    } catch {
      r[nome] = valor;
    }
  }
  return r;
}

// Token no cookie (navegador) ou no Authorization (curl, testes). Nunca na URL.
export async function exigirUsuario(req) {
  const auth = req.headers.authorization;
  const token = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : lerCookies(req.headers.cookie)[COOKIE_ACCESS];
  if (!token) throw naoAutorizado();
  const r = await verificarJwt(token);
  if (!r.ok) throw naoAutorizado();
  return r.usuario;
}

// admin vê tudo; os outros só o que é seu
export function filtroDono(u, campo = "ownerId") {
  return u.papel === "admin" ? {} : { [campo]: u.sub };
}
