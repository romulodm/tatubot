import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac, generateKeyPairSync, sign } from "node:crypto";
import { criarApp } from "../src/app.js";
import { usarBanco, db } from "../src/db.js";
import { registrarChave } from "../src/auth.js";
import { consumidores } from "../src/fila.js";
import { bancoFalso } from "./apoio/banco.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
registrarChave("teste-rotas", publicKey);

function token(sub, papel = "usuario") {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const agora = Math.floor(Date.now() / 1000);
  const base = `${b64({ alg: "RS256", kid: "teste-rotas" })}.${b64({ sub, papel, nome: sub, iss: "tatubot", aud: "tatubot-web", exp: agora + 600 })}`;
  return `${base}.${sign("RSA-SHA256", Buffer.from(base), privateKey).toString("base64url")}`;
}

let servidor;
let base = "";

async function chamar(usuario, metodo, caminho, corpo) {
  const headers = { authorization: `Bearer ${token(usuario)}` };
  if (corpo !== undefined) headers["content-type"] = "application/json";
  const r = await fetch(base + caminho, { method: metodo, headers, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const texto = await r.text();
  return { status: r.status, corpo: texto ? JSON.parse(texto) : null };
}

before(async () => {
  await usarBanco(bancoFalso());
  servidor = criarApp();
  await new Promise((ok) => servidor.listen(0, ok));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(async () => {
  servidor.close();
  await usarBanco(null);
});

describe("rotas com banco em memória", () => {
  let repoId;
  let botId;
  let conversaId;

  it("cadastra um repositório e publica o evento", async () => {
    const r = await chamar("ana", "POST", "/api/repos", { url: "https://github.com/romulodm/tatubot" });
    assert.equal(r.status, 201);
    assert.equal(r.corpo.url, "https://github.com/romulodm/tatubot.git");
    assert.equal(r.corpo.status, "pendente");
    assert.ok(r.corpo.webhookSecret);
    repoId = r.corpo.id;

    const eventos = await (await db()).collection("eventos").find({ tipo: "repo.cadastrado" }).toArray();
    assert.equal(eventos.length, 1);
    assert.equal(eventos[0].payload.repoId, repoId);
  });

  it("recusa repositório duplicado e URL fora do GitHub", async () => {
    const dup = await chamar("ana", "POST", "/api/repos", { url: "https://github.com/romulodm/tatubot.git" });
    assert.equal(dup.status, 409);
    const ruim = await chamar("ana", "POST", "/api/repos", { url: "https://gitlab.com/a/b" });
    assert.equal(ruim.status, 400);
    assert.equal(ruim.corpo.erro.codigo, "VALIDACAO");
  });

  it("lista só os repositórios do dono, sem o segredo do webhook", async () => {
    const r = await chamar("ana", "GET", "/api/repos");
    assert.equal(r.status, 200);
    assert.equal(r.corpo.total, 1);
    assert.equal(r.corpo.itens[0].webhookSecret, undefined);
    const outro = await chamar("bia", "GET", "/api/repos");
    assert.equal(outro.corpo.total, 0);
  });

  it("repositório de outra pessoa responde 404", async () => {
    const r = await chamar("bia", "GET", `/api/repos/${repoId}`);
    assert.equal(r.status, 404);
  });

  it("cria, edita e lista bots", async () => {
    const criado = await chamar("ana", "POST", "/api/bots", { nome: "Guia", modo: "agente", repoIds: [repoId] });
    assert.equal(criado.status, 201);
    assert.deepEqual(criado.corpo.repoIds, [repoId]);
    botId = criado.corpo.id;

    const editado = await chamar("ana", "PATCH", `/api/bots/${botId}`, { instrucoes: "Responda curto." });
    assert.equal(editado.status, 200);
    assert.equal(editado.corpo.instrucoes, "Responda curto.");
    assert.equal(editado.corpo.nome, "Guia");

    const lista = await chamar("ana", "GET", "/api/bots");
    assert.equal(lista.corpo.itens.length, 1);
  });

  it("bot não pode ler repositório de outra pessoa", async () => {
    const r = await chamar("bia", "POST", "/api/bots", { nome: "Intruso", repoIds: [repoId] });
    assert.equal(r.status, 400);
  });

  it("valida o corpo do bot", async () => {
    const semNome = await chamar("ana", "POST", "/api/bots", {});
    assert.equal(semNome.status, 400);
    const modo = await chamar("ana", "POST", "/api/bots", { nome: "X2", modo: "turbo" });
    assert.equal(modo.status, 400);
  });

  it("abre uma conversa e envia uma mensagem (202 + evento)", async () => {
    const c = await chamar("ana", "POST", `/api/bots/${botId}/conversas`, {});
    assert.equal(c.status, 201);
    conversaId = c.corpo.id;

    const m = await chamar("ana", "POST", `/api/conversas/${conversaId}/mensagens`, { conteudo: "Onde fica o login?" });
    assert.equal(m.status, 202);
    assert.equal(m.corpo.resposta.status, "pendente");

    const conversa = await chamar("ana", "GET", `/api/conversas/${conversaId}`);
    assert.equal(conversa.corpo.titulo, "Onde fica o login?");

    const ev = await (await db()).collection("eventos").findOne({ tipo: "mensagem.recebida" });
    assert.equal(ev.payload.conversaId, conversaId);
    assert.equal(ev.payload.bot.modo, "agente");
  });

  it("o worker responde a mensagem (modo local, sem índice)", async () => {
    const ev = await (await db()).collection("eventos").findOne({ tipo: "mensagem.recebida" });
    const consumidor = consumidores.find((c) => c.tipos.includes(ev.tipo));
    await consumidor.processar(ev);

    const msgs = await chamar("ana", "GET", `/api/conversas/${conversaId}/mensagens`);
    assert.equal(msgs.corpo.itens.length, 2);
    const resposta = msgs.corpo.itens[1];
    assert.equal(resposta.autor, "bot");
    assert.equal(resposta.status, "concluida");
    assert.ok(resposta.conteudo.length > 0);
  });

  it("outra pessoa não vê a conversa", async () => {
    const r = await chamar("bia", "GET", `/api/conversas/${conversaId}/mensagens`);
    assert.equal(r.status, 404);
  });

  it("apagar o bot leva as conversas junto", async () => {
    const r = await chamar("ana", "DELETE", `/api/bots/${botId}`);
    assert.equal(r.status, 204);
    const conversas = await chamar("ana", "GET", "/api/conversas");
    assert.equal(conversas.corpo.itens.length, 0);
  });

  it("webhook do GitHub: assinatura, ping e reentrega", async () => {
    const repos = (await db()).collection("repositorios");
    await repos.updateOne({ _id: repoId }, { $set: { branch: "main" } });
    const repo = await repos.findOne({ _id: repoId });
    const corpo = JSON.stringify({ ref: "refs/heads/main", after: "abc123" });
    const assinar = (texto) => "sha256=" + createHmac("sha256", repo.webhookSecret).update(texto).digest("hex");
    const enviar = (headers, texto = corpo) =>
      fetch(`${base}/api/webhooks/github/${repoId}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: texto,
      });

    const falsa = await enviar({ "x-github-event": "push", "x-hub-signature-256": "sha256=00" });
    assert.equal(falsa.status, 401);

    const ping = await enviar({ "x-github-event": "ping", "x-hub-signature-256": assinar(corpo) });
    assert.equal(ping.status, 200);

    const push = { "x-github-event": "push", "x-hub-signature-256": assinar(corpo), "x-github-delivery": "entrega-1" };
    assert.equal((await enviar(push)).status, 202);
    assert.equal((await enviar(push)).status, 202);
    const eventos = await (await db()).collection("eventos").find({ tipo: "repo.sincronizar", produtor: "github" }).toArray();
    assert.equal(eventos.length, 1);
    assert.equal(eventos[0].payload.commitAlvo, "abc123");
  });

  it("corpo que não é JSON e rate limit da sincronização", async () => {
    const r = await fetch(`${base}/api/bots`, {
      method: "POST",
      headers: { authorization: `Bearer ${token("ana")}`, "content-type": "text/plain" },
      body: "oi",
    });
    assert.equal(r.status, 415);

    const status = [];
    for (let i = 0; i < 7; i++) status.push((await chamar("ana", "POST", `/api/repos/${repoId}/sincronizar`)).status);
    assert.deepEqual(status, [202, 202, 202, 202, 202, 202, 429]);
  });

  it("apagar o repositório publica repo.removido", async () => {
    const r = await chamar("ana", "DELETE", `/api/repos/${repoId}`);
    assert.equal(r.status, 204);
    const ev = await (await db()).collection("eventos").findOne({ tipo: "repo.removido" });
    assert.equal(ev.payload.repoId, repoId);
  });
});
