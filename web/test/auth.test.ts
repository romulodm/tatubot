import { describe, it, expect, beforeAll } from "vitest";
import { createPublicKey, verify } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.JWT_PRIVATE_KEY_PATH = path.join(mkdtempSync(path.join(tmpdir(), "tatubot-")), "jwt.pem");

const { hashSenha, conferirSenha } = await import("@/lib/auth");
const { emitirAccess, verificarAccess } = await import("@/lib/auth");
const { jwks } = await import("@/lib/auth");

describe("senha", () => {
  it("scrypt confere a senha certa e rejeita a errada", async () => {
    const h = await hashSenha("correta horse");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(await conferirSenha("correta horse", h)).toBe(true);
    expect(await conferirSenha("errada", h)).toBe(false);
  });
});

describe("access token RS256 + JWKS", () => {
  let token = "";
  beforeAll(async () => {
    token = await emitirAccess({ _id: "u1", papel: "usuario", nome: "Ana" });
  });

  it("cabeçalho com alg RS256 e kid", () => {
    const cab = JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString());
    expect(cab.alg).toBe("RS256");
    expect(typeof cab.kid).toBe("string");
  });

  it("o próprio web verifica o token", async () => {
    expect(await verificarAccess(token)).toEqual({ sub: "u1", papel: "usuario", nome: "Ana" });
  });

  it("a chave do JWKS verifica a assinatura (é o que a api faz)", async () => {
    const { keys } = await jwks();
    const [cab, claims, sig] = token.split(".");
    const kid = JSON.parse(Buffer.from(cab, "base64url").toString()).kid;
    const jwk = keys.find((k) => k.kid === kid)!;
    const publica = createPublicKey({ key: { kty: jwk.kty!, n: jwk.n!, e: jwk.e! }, format: "jwk" });
    expect(verify("RSA-SHA256", Buffer.from(`${cab}.${claims}`), publica, Buffer.from(sig, "base64url"))).toBe(true);
  });

  it("o JWKS não expõe a parte privada da chave", async () => {
    const { keys } = await jwks();
    expect(Object.keys(keys[0]).sort()).toEqual(["alg", "e", "kid", "kty", "n", "use"]);
  });
});
