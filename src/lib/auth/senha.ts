import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (s: string, salt: Buffer, len: number, o: object) => Promise<Buffer>;
const PARAMS = { N: 16384, r: 8, p: 1 };

// Formato: scrypt$N$r$p$salt$hash (base64url). Guardar os parâmetros
// permite endurecer o custo no futuro sem invalidar senhas antigas.
export async function hashSenha(senha: string): Promise<string> {
  const salt = randomBytes(16);
  const h = await scryptAsync(senha, salt, 64, PARAMS);
  return ["scrypt", PARAMS.N, PARAMS.r, PARAMS.p, salt.toString("base64url"), h.toString("base64url")].join("$");
}

export async function conferirSenha(senha: string, armazenado: string): Promise<boolean> {
  const [alg, N, r, p, salt, hash] = armazenado.split("$");
  if (alg !== "scrypt") return false;
  const esperado = Buffer.from(hash, "base64url");
  const h = await scryptAsync(senha, Buffer.from(salt, "base64url"), esperado.length, { N: +N, r: +r, p: +p });
  return h.length === esperado.length && timingSafeEqual(h, esperado);
}

// Hash usado quando o e-mail não existe, para o login levar o mesmo tempo
// nos dois casos (não revelar quais e-mails estão cadastrados).
export const HASH_FALSO = "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$" + "A".repeat(86);
