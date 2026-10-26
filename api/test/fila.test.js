import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { MongoClient } from "mongodb";
import { bancoFalso } from "./apoio/banco.js";

// Roda no Mongo de MONGODB_URI quando ele existe (no CI existe); sem ele, no banco em memória.
process.env.MONGODB_DB = `tatubot_teste_${Date.now()}`;
const uri = process.env.MONGODB_URI ?? "mongodb://localhost:27017";

async function temMongo() {
  const c = new MongoClient(uri, { serverSelectionTimeoutMS: 1500 });
  try {
    await c.connect();
    await c.db("admin").command({ ping: 1 });
    return true;
  } catch {
    return false;
  } finally {
    await c.close().catch(() => {});
  }
}

const disponivel = await temMongo();
const { db, fechar, usarBanco } = await import("../src/db.js");
const { publicar, reivindicar, reagendar, concluir, jaProcessado, marcarProcessado, MAX_TENTATIVAS } = await import("../src/fila.js");

describe(`fila (${disponivel ? "Mongo" : "banco em memória"})`, () => {
  before(async () => {
    if (!disponivel) await usarBanco(bancoFalso());
    await db();
  });
  after(async () => {
    await (await db()).dropDatabase();
    await usarBanco(null);
    await fechar();
  });

  it("reivindica cada evento uma única vez", async () => {
    await publicar("teste.a", { n: 1 }, { correlationId: "c1" });
    const [x, y] = await Promise.all([reivindicar(["teste.a"], 60_000), reivindicar(["teste.a"], 60_000)]);
    assert.equal([x, y].filter(Boolean).length, 1);
    await concluir((x ?? y)._id);
    assert.equal(await reivindicar(["teste.a"], 60_000), null);
  });

  it("reagenda com backoff e manda para a DLQ ao esgotar", async () => {
    const id = await publicar("teste.b", {}, { correlationId: "c2" });
    let ev = await reivindicar(["teste.b"], 60_000);
    assert.equal(await reagendar(ev, "falhou"), "retry");
    assert.equal(await reivindicar(["teste.b"], 60_000), null);
    const col = (await db()).collection("eventos");
    await col.updateOne({ _id: id }, { $set: { tentativas: MAX_TENTATIVAS, disponivelEm: new Date(0) } });
    ev = await col.findOne({ _id: id });
    assert.equal(await reagendar(ev, "falhou de novo"), "dlq");
  });

  it("idempotência por (eventId, consumidor)", async () => {
    const ev = { _id: "ev-1", tipo: "t" };
    assert.equal(await jaProcessado("ev-1", "c"), false);
    await marcarProcessado(ev, "c");
    await marcarProcessado(ev, "c");
    assert.equal(await jaProcessado("ev-1", "c"), true);
    assert.equal(await jaProcessado("ev-1", "outro"), false);
  });
});
