import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validarCitacoes } from "../src/agente/citacoes.js";

const fonte = { repoId: "r1", ghOwner: "acme", ghNome: "api", path: "src/auth.ts", linhaInicio: 10, linhaFim: 40, commitSha: "abc123" };

describe("validação de citações", () => {
  it("mantém citação dentro do que foi lido e numera", () => {
    const r = validarCitacoes("O token é verificado aqui [src/auth.ts:L12-L20].", [fonte]);
    assert.equal(r.texto, "O token é verificado aqui [[1]].");
    assert.equal(r.citacoes[0].path, "src/auth.ts");
    assert.equal(r.citacoes[0].linhaInicio, 12);
    assert.equal(r.citacoes[0].linhaFim, 20);
  });

  it("remove citação para arquivo ou linhas não vistas", () => {
    const r = validarCitacoes("Inventado [src/outro.ts:L1-L5] e fora [src/auth.ts:L100-L120].", [fonte]);
    assert.equal(r.citacoes.length, 0);
    assert.equal(r.removidas.length, 2);
    assert.equal(r.texto, "Inventado e fora.");
  });

  it("recorta ao intervalo visto e deduplica", () => {
    const r = validarCitacoes("a [src/auth.ts:L5-L15] b `src/auth.ts:L5-L15`", [fonte]);
    assert.equal(r.citacoes.length, 1);
    assert.equal(r.citacoes[0].linhaInicio, 10);
    assert.equal(r.texto, "a [[1]] b [[1]]");
  });

  it("escolhe a fonte que cobre o intervalo citado", () => {
    const parte1 = { ...fonte, linhaInicio: 96, linhaFim: 215 };
    const parte2 = { ...fonte, linhaInicio: 201, linhaFim: 320 };
    const r = validarCitacoes("x [src/auth.ts:L201-L320]", [parte1, parte2]);
    assert.equal(r.citacoes[0].linhaInicio, 201);
    assert.equal(r.citacoes[0].linhaFim, 320);
  });

  it("aceita colchetes de rota dinâmica no caminho", () => {
    const f = { ...fonte, path: "app/[locale]/admin/page.tsx", linhaInicio: 1, linhaFim: 60 };
    const r = validarCitacoes("veja [app/[locale]/admin/page.tsx:L1-L60].", [f]);
    assert.equal(r.texto, "veja [[1]].");
    assert.equal(r.citacoes.length, 1);
  });
});
