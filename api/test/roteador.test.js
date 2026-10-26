import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Roteador } from "../src/http.js";

const nada = async () => null;

describe("roteador", () => {
  const r = new Roteador()
    .get("/api/repos", nada)
    .get("/api/repos/:id", nada)
    .delete("/api/repos/:id", nada)
    .post("/api/repos/:id/busca", nada);

  it("casa caminho com parâmetros", () => {
    const a = r.encontrar("GET", "/api/repos/123");
    assert.ok(a && "params" in a);
    assert.deepEqual(a.params, { id: "123" });
  });

  it("decodifica o parâmetro", () => {
    const a = r.encontrar("GET", "/api/repos/a%20b");
    assert.deepEqual(a && "params" in a && a.params, { id: "a b" });
  });

  it("aceita barra no final", () => {
    assert.ok(r.encontrar("GET", "/api/repos/"));
  });

  it("405 quando o caminho existe com outro método", () => {
    assert.deepEqual(r.encontrar("PUT", "/api/repos/1"), { metodosPermitidos: ["GET", "DELETE"] });
  });

  it("404 quando nada casa", () => {
    assert.equal(r.encontrar("GET", "/api/nada"), null);
    assert.equal(r.encontrar("GET", "/api/repos/1/2"), null);
  });
});
