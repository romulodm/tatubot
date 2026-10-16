import { describe, it, expect } from "vitest";
import { quebrarEmChunks, fatiar } from "@/lib/indexacao/chunker";

const codigo = `import jwt from "jose";
const TTL = 15;

/** Verifica o token e devolve as claims. */
export async function verificarToken(token: string) {
  const partes = token.split(".");
  if (partes.length !== 3) throw new Error("formato");
  const claims = decode(partes[1]);
  return claims;
}

export class JwtService {
  private chave = "x";

  constructor(chave: string) {
    this.chave = chave;
    this.iniciar();
    this.log();
  }

  assinar(payload: object) {
    const corpo = JSON.stringify(payload);
    const sig = hmac(this.chave, corpo);
    return corpo + "." + sig;
  }
}

export const handler = async (req: Request) => {
  const t = req.headers.get("authorization");
  if (!t) return new Response(null, { status: 401 });
  const c = await verificarToken(t);
  return Response.json(c);
};
`;

describe("chunker por AST", () => {
  const chunks = quebrarEmChunks("src/auth/jwt.ts", codigo);
  const porSimbolo = (s: string) => chunks.find((c) => c.simbolo === s);

  it("cria um chunk por função, classe e método", () => {
    expect(porSimbolo("verificarToken")?.tipo).toBe("funcao");
    expect(porSimbolo("JwtService")?.tipo).toBe("classe");
    expect(porSimbolo("JwtService.assinar")?.tipo).toBe("metodo");
    expect(porSimbolo("JwtService.constructor")?.tipo).toBe("metodo");
    expect(porSimbolo("handler")?.tipo).toBe("funcao");
  });

  it("inclui o JSDoc e as linhas certas", () => {
    const f = porSimbolo("verificarToken")!;
    expect(f.linhaInicio).toBe(4);
    expect(f.linhaFim).toBe(10);
    expect(f.conteudo.startsWith("/** Verifica")).toBe(true);
  });

  it("prefixa cabeçalho de contexto", () => {
    expect(porSimbolo("JwtService.assinar")!.cabecalho).toBe("arquivo: src/auth/jwt.ts > classe JwtService > método assinar");
  });

  it("joga imports e constantes num chunk de módulo", () => {
    const m = chunks.find((c) => c.tipo === "modulo")!;
    expect(m.conteudo).toContain('import jwt from "jose"');
    expect(m.referencias).toContain("jose");
  });

  it("extrai chamadas como referências", () => {
    expect(porSimbolo("handler")!.referencias).toContain("verificarToken");
  });

  it("subdivide funções longas com overlap", () => {
    const partes = fatiar(1, 300);
    expect(partes.length).toBe(3);
    expect(partes[1].a).toBe(106); // 120 - 15 de overlap
    expect(partes.at(-1)!.b).toBe(300);
  });
});

describe("chunker de markdown", () => {
  it("quebra por heading e monta o caminho", () => {
    const md = "# Projeto\nintro\n## Instalação\nnpm i\n```\n# não é heading\n```\n### Docker\ncompose up\n";
    const c = quebrarEmChunks("README.md", md);
    expect(c.map((x) => x.simbolo)).toEqual(["Projeto", "Instalação", "Docker"]);
    expect(c[2].cabecalho).toBe("arquivo: README.md > Projeto > Instalação > Docker");
    expect(c[1].conteudo).toContain("# não é heading");
  });
});
