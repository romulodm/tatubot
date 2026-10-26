import { describe, expect, it } from "vitest";
import { ErroApp, json, lerJson, limitar, rota, texto, REGEX_EMAIL } from "@/lib/http";

const pedido = (corpo: string, headers: Record<string, string> = {}) =>
  new Request("http://localhost:3000/api/auth/login", { method: "POST", body: corpo, headers });

describe("validação", () => {
  it("texto faz trim e aplica as regras", () => {
    expect(texto({ nome: "  Ana  " }, "nome", { nome: "Nome", min: 2 })).toBe("Ana");
    expect(texto({}, "nome", { nome: "Nome" })).toBeUndefined();
    expect(() => texto({}, "nome", { nome: "Nome", obrigatorio: true })).toThrow("Nome é obrigatório");
    expect(() => texto({ nome: "A" }, "nome", { nome: "Nome", min: 2 })).toThrow("pelo menos 2");
    expect(() => texto({ nome: 3 }, "nome", { nome: "Nome" })).toThrow("deve ser texto");
  });

  it("e-mail", () => {
    expect(REGEX_EMAIL.test("ana@exemplo.com")).toBe(true);
    expect(REGEX_EMAIL.test("ana@exemplo")).toBe(false);
  });
});

describe("corpo", () => {
  it("lê objeto JSON e recusa o resto", async () => {
    expect(await lerJson(pedido('{"a":1}'))).toEqual({ a: 1 });
    expect(await lerJson(pedido(""))).toEqual({});
    await expect(lerJson(pedido("[1,2]"))).rejects.toMatchObject({ codigo: "JSON_INVALIDO" });
    await expect(lerJson(pedido("{oi"))).rejects.toMatchObject({ codigo: "JSON_INVALIDO" });
    await expect(lerJson(pedido("x".repeat(70_000)))).rejects.toMatchObject({ status: 413 });
  });
});

describe("rota", () => {
  const ok = rota(async () => json({ ok: true }));
  const quebra = rota(async () => {
    throw new ErroApp(409, "EMAIL_EM_USO", "Já existe");
  });
  const segs = { params: Promise.resolve({}) };

  it("erro sai no formato padrão, com correlation id", async () => {
    const r = await quebra(pedido("{}", { "x-correlation-id": "abc" }), segs);
    expect(r.status).toBe(409);
    expect(r.headers.get("x-correlation-id")).toBe("abc");
    expect(await r.json()).toEqual({ erro: { codigo: "EMAIL_EM_USO", mensagem: "Já existe", detalhes: {} } });
  });

  it("recusa POST vindo de outra origem", async () => {
    const r = await ok(pedido("{}", { origin: "https://malicioso.com", host: "localhost:3000" }), segs);
    expect(r.status).toBe(403);
    const mesma = await ok(pedido("{}", { origin: "http://localhost:3000", host: "localhost:3000" }), segs);
    expect(mesma.status).toBe(200);
  });
});

describe("rate limit", () => {
  it("bloqueia depois do máximo na janela", () => {
    const chave = `teste:${Math.random()}`;
    for (let i = 0; i < 3; i++) limitar(chave, 3, 60_000);
    expect(() => limitar(chave, 3, 60_000)).toThrow(/Tente de novo/);
  });
});
