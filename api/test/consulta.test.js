import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analisarConsulta, cobre, raiz } from "../src/busca/consulta.js";
import { fraseDoAssunto } from "../src/agente/extrativo.js";
import { respostaConversaLocal } from "../src/agente/conversa.js";

describe("intenção", () => {
  for (const t of ["Oi, como vai?", "olá!", "bom dia", "valeu!", "obrigado", "o que você faz?", "tudo bem?"]) {
    it(`'${t}' é conversa`, () => assert.equal(analisarConsulta(t).intencao, "conversa"));
  }
  it("pergunta com assunto não é conversa, mesmo começando com oi", () => {
    assert.equal(analisarConsulta("Oi, onde fica o login?").intencao, "localizar");
  });
  it("onde/qual arquivo = localizar; como funciona = explicar", () => {
    assert.equal(analisarConsulta("Onde fica os arquivos do modal de autenticação?").intencao, "localizar");
    assert.equal(analisarConsulta("como funciona o envio de email").intencao, "explicar");
  });
});

describe("conceitos", () => {
  const c = analisarConsulta("Onde fica os arquivos do modal de autenticação?");
  it("descarta palavras de pergunta e mantém o assunto", () => {
    assert.deepEqual(
      c.conceitos.map((k) => k.palavra),
      ["modal", "autenticação"],
    );
  });
  it("traduz para os termos que aparecem no código", () => {
    const auth = c.conceitos[1];
    assert.equal(cobre(auth, ["auth", "modal", "provid"]), true);
    assert.equal(cobre(auth, ["privacy", "polic"]), false);
  });
  it("raiz junta variações", () => {
    assert.equal(raiz("autenticação"), raiz("autenticar"));
    assert.equal(raiz("modais"), "modal");
  });
  it("frase do assunto vem da pergunta", () => {
    assert.equal(fraseDoAssunto(c), "modal de autenticação");
  });
});

describe("conversa sem LLM", () => {
  it("cumprimenta e se apresenta sem buscar", () => {
    const r = respostaConversaLocal("Oi, como vai?", { nome: "Guia" }, ["romulodm/romulodm.dev"], false);
    assert.match(r, /^Oi! Tudo certo/);
    assert.ok(r.includes("romulodm/romulodm.dev"));
  });
});
