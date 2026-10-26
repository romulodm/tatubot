import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { quebrarEmChunks, fatiar } from "../src/indexacao/chunker.js";

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
  const porSimbolo = (s) => chunks.find((c) => c.simbolo === s);

  it("cria um chunk por função, classe e método", () => {
    assert.equal(porSimbolo("verificarToken")?.tipo, "funcao");
    assert.equal(porSimbolo("JwtService")?.tipo, "classe");
    assert.equal(porSimbolo("JwtService.assinar")?.tipo, "metodo");
    assert.equal(porSimbolo("JwtService.constructor")?.tipo, "metodo");
    assert.equal(porSimbolo("handler")?.tipo, "funcao");
  });

  it("inclui o JSDoc e as linhas certas", () => {
    const f = porSimbolo("verificarToken");
    assert.equal(f?.linhaInicio, 4);
    assert.equal(f?.linhaFim, 10);
    assert.ok(f?.conteudo.startsWith("/** Verifica"));
  });

  it("prefixa cabeçalho de contexto", () => {
    assert.equal(porSimbolo("JwtService.assinar")?.cabecalho, "arquivo: src/auth/jwt.ts > classe JwtService > método assinar");
  });

  it("joga imports e constantes num chunk de módulo", () => {
    const m = chunks.find((c) => c.tipo === "modulo");
    assert.ok(m?.conteudo.includes('import jwt from "jose"'));
    assert.ok(m?.referencias.includes("jose"));
  });

  it("extrai chamadas como referências", () => {
    assert.ok(porSimbolo("handler")?.referencias.includes("verificarToken"));
  });

  it("subdivide funções longas com overlap", () => {
    const partes = fatiar(1, 300);
    assert.equal(partes.length, 3);
    assert.equal(partes[1].a, 106);
    assert.equal(partes.at(-1)?.b, 300);
  });
});

describe("chunker de markdown", () => {
  it("quebra por heading e monta o caminho", () => {
    const md = "# Projeto\nintro\n## Instalação\nnpm i\n```\n# não é heading\n```\n### Docker\ncompose up\n";
    const c = quebrarEmChunks("README.md", md);
    assert.deepEqual(
      c.map((x) => x.simbolo),
      ["Projeto", "Instalação", "Docker"],
    );
    assert.equal(c[2].cabecalho, "arquivo: README.md > Projeto > Instalação > Docker");
    assert.ok(c[1].conteudo.includes("# não é heading"));
  });
});
