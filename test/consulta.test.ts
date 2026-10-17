import { describe, it, expect } from "vitest";
import { analisarConsulta, cobre, raiz } from "@/lib/busca/consulta";
import { fraseDoAssunto } from "@/lib/agente/extrativo";
import { respostaConversaLocal } from "@/lib/agente/conversa";

describe("intenção", () => {
  it.each(["Oi, como vai?", "olá!", "bom dia", "valeu!", "obrigado", "o que você faz?", "tudo bem?"])("'%s' é conversa", (t) => {
    expect(analisarConsulta(t).intencao).toBe("conversa");
  });
  it("pergunta com assunto não é conversa, mesmo começando com oi", () => {
    expect(analisarConsulta("Oi, onde fica o login?").intencao).toBe("localizar");
  });
  it("onde/qual arquivo = localizar; como funciona = explicar", () => {
    expect(analisarConsulta("Onde fica os arquivos do modal de autenticação?").intencao).toBe("localizar");
    expect(analisarConsulta("como funciona o envio de email").intencao).toBe("explicar");
  });
});

describe("conceitos", () => {
  const c = analisarConsulta("Onde fica os arquivos do modal de autenticação?");
  it("descarta palavras de pergunta e mantém o assunto", () => {
    expect(c.conceitos.map((k) => k.palavra)).toEqual(["modal", "autenticação"]);
  });
  it("traduz para os termos que aparecem no código", () => {
    const auth = c.conceitos[1];
    expect(cobre(auth, ["auth", "modal", "provid"])).toBe(true);
    expect(cobre(auth, ["privacy", "polic"])).toBe(false);
  });
  it("raiz junta variações", () => {
    expect(raiz("autenticação")).toBe(raiz("autenticar"));
    expect(raiz("modais")).toBe("modal");
  });
  it("frase do assunto vem da pergunta", () => {
    expect(fraseDoAssunto(c)).toBe("modal de autenticação");
  });
});

describe("conversa sem LLM", () => {
  it("cumprimenta e se apresenta sem buscar", () => {
    const r = respostaConversaLocal("Oi, como vai?", { nome: "Guia" }, ["romulodm/romulodm.dev"], false);
    expect(r).toMatch(/^Oi! Tudo certo/);
    expect(r).toContain("romulodm/romulodm.dev");
  });
});
