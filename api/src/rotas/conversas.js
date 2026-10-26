import { randomUUID } from "node:crypto";
import { db, agora } from "../db.js";
import { naoEncontrado } from "../erros.js";
import { exigirUsuario, filtroDono } from "../auth.js";
import { abrirSse, json, lerJson, limitar, semConteudo, texto } from "../http.js";
import { publicar } from "../fila.js";
import { analisarConsulta } from "../busca/consulta.js";
import { botDoUsuario, conversaDoUsuario, conversaPublica, mensagemPublica } from "./recursos.js";

export function rotasConversas(r) {
  r.get("/api/conversas", async ({ req, url }) => {
    const u = await exigirUsuario(req);
    const filtro = filtroDono(u, "usuarioId");
    const botId = url.searchParams.get("botId");
    if (botId) filtro.botId = botId;
    const itens = await (await db()).collection("conversas").find(filtro).sort({ atualizadoEm: -1 }).limit(100).toArray();
    return json({ itens: itens.map(conversaPublica) });
  });

  r.get("/api/conversas/:id", async ({ req, params }) => {
    const u = await exigirUsuario(req);
    return json(conversaPublica(await conversaDoUsuario(u, params.id)));
  });

  r.delete("/api/conversas/:id", async ({ req, params }) => {
    const u = await exigirUsuario(req);
    const c = await conversaDoUsuario(u, params.id);
    const d = await db();
    await d.collection("mensagens").deleteMany({ conversaId: c._id });
    await d.collection("conversas").deleteOne({ _id: c._id });
    return semConteudo();
  });

  r.get("/api/conversas/:id/mensagens", async ({ req, params }) => {
    const u = await exigirUsuario(req);
    const c = await conversaDoUsuario(u, params.id);
    const itens = await (await db()).collection("mensagens").find({ conversaId: c._id }).sort({ criadoEm: 1 }).limit(500).toArray();
    return json({ itens: itens.map(mensagemPublica) });
  });

  // Grava a pergunta e uma resposta "pendente", publica o evento e volta 202.
  // O worker responde e o texto chega pelo SSE abaixo.
  r.post("/api/conversas/:id/mensagens", async ({ req, params, correlationId }) => {
    const u = await exigirUsuario(req);
    limitar(`msg:${u.sub}`, 10, 60_000);
    const c = await conversaDoUsuario(u, params.id);
    const bot = await botDoUsuario(u, c.botId);
    const conteudo = texto(await lerJson(req), "conteudo", { nome: "Mensagem", obrigatorio: true, max: 4000 });

    const d = await db();
    const mensagens = d.collection("mensagens");
    const historico = await mensagens.find({ conversaId: c._id, status: "concluida" }).sort({ criadoEm: -1 }).limit(10).toArray();

    const t = agora();
    const base = { conversaId: c._id, citacoes: [], trilha: [], erro: null, correlationId, execucaoId: null, atualizadoEm: t };
    const pergunta = { ...base, _id: randomUUID(), autor: "usuario", conteudo, status: "concluida", criadoEm: t };
    const resposta = { ...base, _id: randomUUID(), autor: "bot", conteudo: "", status: "pendente", criadoEm: new Date(t.getTime() + 1) };
    await mensagens.insertMany([pergunta, resposta]);

    // "oi, tudo bem?" não vira título
    const virouTitulo = c.titulo === "Nova conversa" && analisarConsulta(conteudo).intencao !== "conversa";
    const titulo = virouTitulo ? conteudo.replace(/\s+/g, " ").slice(0, 60) : c.titulo;
    await d.collection("conversas").updateOne({ _id: c._id }, { $set: { titulo, atualizadoEm: t } });

    await publicar(
      "mensagem.recebida",
      {
        mensagemId: resposta._id,
        conversaId: c._id,
        usuarioId: u.sub,
        bot: { id: bot._id, nome: bot.nome, instrucoes: bot.instrucoes, modo: bot.modo },
        repoIds: bot.repoIds,
        historico: historico.reverse().map((m) => ({ autor: m.autor, conteudo: m.conteudo })),
        conteudo,
      },
      { correlationId },
    );
    return json({ pergunta: mensagemPublica(pergunta), resposta: mensagemPublica(resposta) }, 202);
  });

  // SSE por polling curto (change streams exigiriam replica set).
  r.get("/api/conversas/:id/eventos", async ({ req, res, params, correlationId }) => {
    const u = await exigirUsuario(req);
    const c = await conversaDoUsuario(u, params.id);
    const mensagens = (await db()).collection("mensagens");

    const sse = abrirSse(res, correlationId);
    let fechado = false;
    req.on("close", () => (fechado = true));

    // fecha em 5 min; o EventSource reconecta sozinho
    const limite = Date.now() + 5 * 60_000;
    let ultimoPing = Date.now();

    const abertas = await mensagens.find({ conversaId: c._id, status: { $in: ["pendente", "processando"] } }).toArray();
    for (const m of abertas) sse.evento("mensagem", mensagemPublica(m));
    let marca = new Date();

    while (!fechado && Date.now() < limite) {
      await new Promise((ok) => setTimeout(ok, 350));
      const mudadas = await mensagens
        .find({ conversaId: c._id, autor: "bot", atualizadoEm: { $gt: marca } })
        .sort({ atualizadoEm: 1 })
        .toArray();
      for (const m of mudadas) {
        sse.evento("mensagem", mensagemPublica(m));
        if (m.atualizadoEm > marca) marca = m.atualizadoEm;
      }
      if (Date.now() - ultimoPing > 15_000) {
        ultimoPing = Date.now();
        sse.ping();
      }
    }
    sse.fechar();
    return null;
  });

  r.get("/api/execucoes/:id", async ({ req, params }) => {
    const u = await exigirUsuario(req);
    const e = await (await db()).collection("execucoes").findOne({ _id: params.id, ...filtroDono(u, "usuarioId") });
    if (!e) throw naoEncontrado("EXECUCAO_NAO_ENCONTRADA", "Execução não encontrada");
    const { _id, ...resto } = e;
    return json({ id: _id, ...resto });
  });
}
