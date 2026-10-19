import { createPublicKey } from "node:crypto";
import { config } from "../config.js";
import { log } from "../log.js";

// Chaves públicas do web, buscadas em /.well-known/jwks.json.
//
// Por que JWKS e não um segredo compartilhado (HS256)?
//   Com HS256, quem consegue VERIFICAR um token também consegue ASSINAR um.
//   Se a API vazasse o segredo, daria para fabricar token de admin.
//   Com RS256 só o web tem a chave privada; aqui guardamos apenas a pública.
//
// Cada chave tem um "kid" (key id). Quando o web trocar de chave, tokens novos
// chegam com um kid que não conhecemos e isso dispara uma recarga do JWKS.
// Para um token forjado com kid aleatório não virar um ataque de negação de
// serviço contra o web, a recarga acontece no máximo uma vez por minuto
// (ou a cada 5 s enquanto ainda não conseguimos carregar nenhuma chave, por
// exemplo quando a API sobe antes do web).

const INTERVALO_RECARGA_MS = 60_000;
const INTERVALO_SEM_CHAVES_MS = 5_000;

/** @type {Map<string, import("node:crypto").KeyObject>} */
const chaves = new Map();
let ultimaTentativa = 0;
/** @type {Promise<void> | null} */
let carregando = null;

/**
 * Baixa o JWKS e troca o conjunto de chaves em memória.
 * Só aceita chaves RSA de assinatura; o resto é ignorado.
 */
export async function carregarJwks() {
  ultimaTentativa = Date.now();
  const res = await fetch(config.jwt.jwksUrl, { signal: AbortSignal.timeout(5_000) });
  if (!res.ok) throw new Error(`JWKS respondeu ${res.status}`);
  const corpo = /** @type {{ keys?: Record<string, string>[] }} */ (await res.json());
  const novas = new Map();
  for (const jwk of corpo.keys ?? []) {
    if (jwk.kty !== "RSA" || !jwk.kid) continue;
    if (jwk.use && jwk.use !== "sig") continue;
    if (jwk.alg && jwk.alg !== "RS256") continue;
    // O próprio Node monta a chave a partir do JWK (n e e em base64url).
    novas.set(jwk.kid, createPublicKey({ key: { kty: jwk.kty, n: jwk.n, e: jwk.e }, format: "jwk" }));
  }
  if (!novas.size) throw new Error("JWKS sem chaves RSA de assinatura");
  chaves.clear();
  for (const [kid, k] of novas) chaves.set(kid, k);
  log("info", "jwks carregado", { kids: [...chaves.keys()] });
}

/**
 * Devolve a chave pública de um kid, recarregando o JWKS se for preciso
 * (e se o intervalo mínimo já passou).
 * @param {string} kid
 */
export async function chavePorKid(kid) {
  const k = chaves.get(kid);
  if (k) return k;
  const intervalo = chaves.size ? INTERVALO_RECARGA_MS : INTERVALO_SEM_CHAVES_MS;
  if (Date.now() - ultimaTentativa >= intervalo) {
    // Várias requisições ao mesmo tempo compartilham a mesma recarga.
    carregando ??= carregarJwks()
      .catch((e) => log("aviso", "falha ao carregar o JWKS", { url: config.jwt.jwksUrl, erro: String(e.message ?? e) }))
      .finally(() => (carregando = null));
    await carregando;
  }
  return chaves.get(kid) ?? null;
}

/**
 * Registra uma chave à mão. Usado pelos testes, que geram um par RSA na hora
 * em vez de subir o web.
 * @param {string} kid
 * @param {import("node:crypto").KeyObject} chave
 */
export function registrarChave(kid, chave) {
  chaves.set(kid, chave);
  ultimaTentativa = Date.now();
}
