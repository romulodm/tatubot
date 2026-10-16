import { createHmac, timingSafeEqual } from "node:crypto";

// X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(corpo, segredo). Comparação em tempo constante.
export function assinaturaValida(corpo: string, assinatura: string, segredo: string) {
  const esperado = Buffer.from("sha256=" + createHmac("sha256", segredo).update(corpo).digest("hex"));
  const recebido = Buffer.from(assinatura);
  return esperado.length === recebido.length && timingSafeEqual(esperado, recebido);
}
