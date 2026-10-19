import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { MongoClient } from "mongodb";

// Teste de integração da fila: precisa de um MongoDB em MONGODB_URI
// (ex.: `docker compose up -d mongo`). Sem banco, o teste é pulado.
// Usa um banco descartável, apagado no final.
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
const { db, fechar } = await import("../src/db.js");
const { publicar, reivindicar, reagendar, concluir, jaProcessado, marcarProcessado, MAX_TENTATIVAS } = await import("../src/fila/fila.js");

describe("fila no Mongo", { skip: disponivel ? false : `sem MongoDB em ${uri}` }, () => {
  before(async () => {
    await db();
  });
  after(async () => {
    await (await db()).dropDatabase();
    await fechar();
  });

  it("reivindica cada evento uma única vez", async () => {
    await publicar("teste.a", { n: 1 }, { correlationId: "c1" });
    const [x, y] = await Promise.all([reivindicar(["teste.a"], 60_000), reivindicar(["teste.a"], 60_000)]);
    assert.equal([x, y].filter(Boolean).length, 1);
    await concluir(/** @type {any} */ (x ?? y)._id);
    assert.equal(await reivindicar(["teste.a"], 60_000), null);
  });

  it("reagenda com backoff e manda para a DLQ ao esgotar", async () => {
    const id = await publicar("teste.b", {}, { correlationId: "c2" });
    let ev = await reivindicar(["teste.b"], 60_000);
    assert.equal(await reagendar(/** @type {any} */ (ev), "falhou"), "retry");
    assert.equal(await reivindicar(["teste.b"], 60_000), null); // ainda no atraso de 5 s
    // simula tentativas esgotadas
    const col = (await db()).collection("eventos");
    await col.updateOne({ _id: /** @type {any} */ (id) }, { $set: { tentativas: MAX_TENTATIVAS, disponivelEm: new Date(0) } });
    ev = /** @type {any} */ (await col.findOne({ _id: /** @type {any} */ (id) }));
    assert.equal(await reagendar(/** @type {any} */ (ev), "falhou de novo"), "dlq");
  });

  it("idempotência por (eventId, consumidor)", async () => {
    const ev = { _id: "ev-1", tipo: "t" };
    assert.equal(await jaProcessado("ev-1", "c"), false);
    await marcarProcessado(ev, "c");
    await marcarProcessado(ev, "c"); // duplicata não explode
    assert.equal(await jaProcessado("ev-1", "c"), true);
    assert.equal(await jaProcessado("ev-1", "outro"), false);
  });
});

if (!disponivel) await fechar();
