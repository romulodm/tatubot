import { describe, it, expect, beforeAll, afterAll } from "vitest";

// Usa um banco de teste separado. Requer MongoDB (ou FerretDB) em MONGODB_URI.
process.env.MONGODB_DB = `repobot_teste_${Date.now()}`;

const { db, cliente } = await import("@/lib/db");
const { publicar, reivindicar, reagendar, concluir, jaProcessado, marcarProcessado, MAX_TENTATIVAS } = await import("@/lib/fila/fila");

describe("fila no Mongo", () => {
  beforeAll(async () => {
    await db();
  });
  afterAll(async () => {
    await (await db()).dropDatabase();
    await (await cliente()).close();
  });

  it("reivindica cada evento uma única vez", async () => {
    await publicar("teste.a", { n: 1 }, { correlationId: "c1" });
    const [x, y] = await Promise.all([reivindicar(["teste.a"], 60_000), reivindicar(["teste.a"], 60_000)]);
    expect([x, y].filter(Boolean)).toHaveLength(1);
    await concluir((x ?? y)!._id);
    expect(await reivindicar(["teste.a"], 60_000)).toBeNull();
  });

  it("reagenda com backoff e manda para a DLQ ao esgotar", async () => {
    const id = await publicar("teste.b", {}, { correlationId: "c2" });
    let ev = await reivindicar(["teste.b"], 60_000);
    expect(await reagendar(ev!, "falhou")).toBe("retry");
    expect(await reivindicar(["teste.b"], 60_000)).toBeNull(); // ainda no atraso de 5 s
    // simula tentativas esgotadas
    await (await db()).collection("eventos").updateOne({ _id: id as never }, { $set: { tentativas: MAX_TENTATIVAS, disponivelEm: new Date(0) } });
    ev = (await (await db()).collection("eventos").findOne({ _id: id as never })) as never;
    expect(await reagendar(ev!, "falhou de novo")).toBe("dlq");
  });

  it("idempotência por (eventId, consumidor)", async () => {
    const ev = { _id: "ev-1", tipo: "t" } as never;
    expect(await jaProcessado("ev-1", "c")).toBe(false);
    await marcarProcessado(ev, "c");
    await marcarProcessado(ev, "c"); // duplicata não explode
    expect(await jaProcessado("ev-1", "c")).toBe(true);
    expect(await jaProcessado("ev-1", "outro")).toBe(false);
  });
});
