import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHmac, generateKeyPairSync, sign } from "node:crypto";
import { lerCookies, registrarChave, verificarJwt } from "../src/auth.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
registrarChave("chave-teste", publicKey);

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const agora = () => Math.floor(Date.now() / 1000);

function token(claims, cab = { alg: "RS256", typ: "JWT", kid: "chave-teste" }) {
  const base = `${b64(cab)}.${b64(claims)}`;
  return `${base}.${sign("RSA-SHA256", Buffer.from(base), privateKey).toString("base64url")}`;
}

const valido = { sub: "u1", papel: "usuario", nome: "Ana", iss: "tatubot", aud: "tatubot-web", iat: agora(), exp: agora() + 600 };

describe("verificação de JWT à mão", () => {
  it("aceita um token válido e devolve as claims", async () => {
    const r = await verificarJwt(token(valido));
    assert.equal(r.ok, true);
    assert.deepEqual(r.ok && r.usuario, { sub: "u1", papel: "usuario", nome: "Ana" });
  });

  it('rejeita alg "none" (token sem assinatura)', async () => {
    const t = `${b64({ alg: "none", kid: "chave-teste" })}.${b64(valido)}.`;
    assert.deepEqual(await verificarJwt(t), { ok: false, motivo: "alg" });
  });

  it("rejeita HS256 assinado com a chave pública (confusão de algoritmo)", async () => {
    const cab = b64({ alg: "HS256", kid: "chave-teste" });
    const base = `${cab}.${b64(valido)}`;
    const pem = publicKey.export({ type: "spki", format: "pem" });
    const t = `${base}.${createHmac("sha256", pem).update(base).digest("base64url")}`;
    assert.deepEqual(await verificarJwt(t), { ok: false, motivo: "alg" });
  });

  it("rejeita assinatura adulterada (trocar o papel para admin)", async () => {
    const [cab, , sig] = token(valido).split(".");
    const t = `${cab}.${b64({ ...valido, papel: "admin" })}.${sig}`;
    assert.deepEqual(await verificarJwt(t), { ok: false, motivo: "assinatura" });
  });

  it("rejeita token expirado", async () => {
    const r = await verificarJwt(token({ ...valido, exp: agora() - 3600 }));
    assert.deepEqual(r, { ok: false, motivo: "expirado" });
  });

  it("rejeita aud e iss errados", async () => {
    assert.deepEqual(await verificarJwt(token({ ...valido, aud: "outro-sistema" })), { ok: false, motivo: "aud" });
    assert.deepEqual(await verificarJwt(token({ ...valido, iss: "outro" })), { ok: false, motivo: "iss" });
  });

  it("rejeita kid desconhecido", async () => {
    const r = await verificarJwt(token(valido, { alg: "RS256", kid: "nao-existe" }));
    assert.deepEqual(r, { ok: false, motivo: "kid" });
  });

  it("rejeita lixo", async () => {
    assert.deepEqual(await verificarJwt("abc"), { ok: false, motivo: "formato" });
    assert.deepEqual(await verificarJwt("a.b.c"), { ok: false, motivo: "formato" });
  });
});

describe("cookies", () => {
  it("lê o header Cookie sem biblioteca", () => {
    assert.deepEqual(lerCookies("rb_access=abc.def; tema=escuro"), { rb_access: "abc.def", tema: "escuro" });
    assert.deepEqual(lerCookies(undefined), {});
  });
});
