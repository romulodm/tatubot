import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { criarApp } from "../src/app.js";

// Sobe o app numa porta aleatória e faz requisições de verdade.
// Estes casos não chegam a tocar no banco: a requisição é barrada antes.

/** @type {import("node:http").Server} */
let servidor;
let base = "";

before(async () => {
  servidor = criarApp();
  await new Promise((ok) => servidor.listen(0, () => ok(null)));
  const endereco = /** @type {import("node:net").AddressInfo} */ (servidor.address());
  base = `http://127.0.0.1:${endereco.port}`;
});

after(() => servidor.close());

describe("http", () => {
  it("401 sem token, no formato de erro padrão", async () => {
    const r = await fetch(`${base}/api/bots`);
    assert.equal(r.status, 401);
    const corpo = await r.json();
    assert.equal(corpo.erro.codigo, "NAO_AUTENTICADO");
    assert.ok(r.headers.get("x-correlation-id"));
  });

  it("401 com token inválido no cookie", async () => {
    const r = await fetch(`${base}/api/repos`, { headers: { cookie: "rb_access=a.b.c" } });
    assert.equal(r.status, 401);
  });

  it("404 para rota que não existe", async () => {
    const r = await fetch(`${base}/api/nao-existe`);
    assert.equal(r.status, 404);
    assert.equal((await r.json()).erro.codigo, "ROTA_NAO_ENCONTRADA");
  });

  it("405 com header Allow", async () => {
    const r = await fetch(`${base}/api/bots`, { method: "PUT" });
    assert.equal(r.status, 405);
    assert.equal(r.headers.get("allow"), "GET, POST");
  });

  it("403 para mutação vinda de outra origem (CSRF)", async () => {
    const r = await fetch(`${base}/api/bots`, {
      method: "POST",
      headers: { origin: "https://site-malicioso.com", "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(r.status, 403);
    assert.equal((await r.json()).erro.codigo, "ORIGEM_INVALIDA");
  });

  it("propaga o correlation id recebido", async () => {
    const r = await fetch(`${base}/api/bots`, { headers: { "x-correlation-id": "abc-123" } });
    assert.equal(r.headers.get("x-correlation-id"), "abc-123");
  });
});
