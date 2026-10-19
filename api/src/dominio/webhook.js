import { createHmac, timingSafeEqual } from "node:crypto";

// O GitHub assina o corpo de cada webhook com o segredo que cadastramos:
//   X-Hub-Signature-256: sha256=<HMAC-SHA256(corpo, segredo) em hex>
// Recalculamos e comparamos em tempo constante (timingSafeEqual). Uma
// comparação com === pararia no primeiro caractere diferente, e o tempo de
// resposta vazaria quantos caracteres o atacante acertou.

/**
 * @param {string} corpo corpo CRU da requisição (os bytes exatos)
 * @param {string} assinatura valor do header X-Hub-Signature-256
 * @param {string} segredo webhookSecret do repositório
 */
export function assinaturaValida(corpo, assinatura, segredo) {
  const esperado = Buffer.from("sha256=" + createHmac("sha256", segredo).update(corpo).digest("hex"));
  const recebido = Buffer.from(assinatura);
  return esperado.length === recebido.length && timingSafeEqual(esperado, recebido);
}
