import { describe, it, expect } from "vitest";
import { validarCitacoes, linkGithub } from "@/lib/agente/citacoes";

const fonte = { repoId: "r1", ghOwner: "acme", ghNome: "api", path: "src/auth.ts", linhaInicio: 10, linhaFim: 40, commitSha: "abc123" };

describe("validação de citações", () => {
  it("mantém citação dentro do que foi lido e numera", () => {
    const r = validarCitacoes("O token é verificado aqui [src/auth.ts:L12-L20].", [fonte]);
    expect(r.texto).toBe("O token é verificado aqui [[1]].");
    expect(r.citacoes[0]).toMatchObject({ path: "src/auth.ts", linhaInicio: 12, linhaFim: 20 });
  });

  it("remove citação para arquivo ou linhas não vistas", () => {
    const r = validarCitacoes("Inventado [src/outro.ts:L1-L5] e fora [src/auth.ts:L100-L120].", [fonte]);
    expect(r.citacoes).toHaveLength(0);
    expect(r.removidas).toHaveLength(2);
    expect(r.texto).toBe("Inventado e fora.");
  });

  it("recorta ao intervalo visto e deduplica", () => {
    const r = validarCitacoes("a [src/auth.ts:L5-L15] b `src/auth.ts:L5-L15`", [fonte]);
    expect(r.citacoes).toHaveLength(1);
    expect(r.citacoes[0].linhaInicio).toBe(10);
    expect(r.texto).toBe("a [[1]] b [[1]]");
  });

  it("monta link do GitHub fixado no commit", () => {
    expect(linkGithub(fonte)).toBe("https://github.com/acme/api/blob/abc123/src/auth.ts#L10-L40");
  });
});

describe("fontes sobrepostas", () => {
  it("escolhe a fonte que cobre o intervalo citado", () => {
    const parte1 = { ...fonte, linhaInicio: 96, linhaFim: 215 };
    const parte2 = { ...fonte, linhaInicio: 201, linhaFim: 320 };
    const r = validarCitacoes("x [src/auth.ts:L201-L320]", [parte1, parte2]);
    expect(r.citacoes[0]).toMatchObject({ linhaInicio: 201, linhaFim: 320 });
  });
});

describe("caminhos com rota dinâmica", () => {
  it("aceita colchetes no caminho", () => {
    const f = { ...fonte, path: "app/[locale]/admin/page.tsx", linhaInicio: 1, linhaFim: 60 };
    const r = validarCitacoes("veja [app/[locale]/admin/page.tsx:L1-L60].", [f]);
    expect(r.texto).toBe("veja [[1]].");
    expect(r.citacoes).toHaveLength(1);
  });
});
