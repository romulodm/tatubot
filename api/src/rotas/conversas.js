import { randomUUID } from "node:crypto";
import { db, agora } from "../db.js";
import { naoEncontrado } from "../erros.js";
import { exigirUsuario, filtroDono } from "../http/auth.js";
import { lerJson } from "../http/corpo.js";
import { limitar } from "../http/limite.js";
import { abrirSse, json, semConteudo } from "../http/responder.js";
import { texto } from "../http/validar.js";
import { publicar } from "../fila/fila.js";
import { analisarConsulta } from "../busca/consulta.js";
import { botDoUsuario, conversaDoUsuario, conversaPublica, mensagemPublica } from "../dominio/recursos.js";

// Conversas, mensagens, o stream de eventos (SSE) e as execuções do bot.

/** @param {import("../http/roteador.js").Roteador} r */
export function rotasConversas(r) {
  r.get("/api/conversas", async ({ req, url }) => {
    const u = await exigirUsuario(req);
    const botId = url.searchParams.get("botId");
    /** @type {Record<string, unknown>} */
    const filtro = { ...filtroDono(u, "usuarioId") };
    if (botId) filtro.botId = botId;
    const itens = await (await db()).collection("conversas").find(filtro).sort({ atualizadoEm: -1 }).limit(100).toArray();
    return json({ itens: itens.map((c) => conversaPublica(/** @type {any} */ (c))) });
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
    await d.collection("conversas").deleteOne({ _id: /** @type {any} */ (c._id) });
    return semConteudo();
  });

  r.get("/api/conversas/:id/mensagens", async ({ req, params }) => {
    const u = await exigirUsuario(req);
    const c = await conversaDoUsuario(u, params.id);
    const itens = await (await db()).collection("mensagens").find({ conversaId: c._id }).sort({ criadoEm: 1 }).limit(500).toArray();
    return json({ itens: itens.map((m) => mensagemPublica(/** @type {any} */ (m))) });
  });

  // Envio ASSÍNCRONO: grava a pergunta, cria a resposta "pendente", publica
  // mensagem.recebida e devolve 202 na hora. Quem responde é o worker; a
  // resposta chega ao navegador pelo SSE logo abaixo.
  r.post("/api/conversas/:id/mensagens", async ({ req, params, correlationId }) => {
    const u = await exigirUsuario(req);
    limitar(`msg:${u.sub}`, 10, 60_000);
    const c = await conversaDoUsuario(u, params.id);
    const bot = await botDoUsuario(u, c.botId);
    const conteudo = /** @type {string} */ (texto(await lerJson(req), "conteudo", { nome: "Mensagem", obrigatorio: true, max: 4000 }));

    const d = await db();
    const col = d.collection("mensagens");
    const historico = await col.find({ conversaId: c._id, status: "concluida" }).sort({ criadoEm: -1 }).limit(10).toArray();

    const t = agora();
    const base = { conversaId: c._id, citacoes: [], trilha: [], erro: null, correlationId, execucaoId: null, atualizadoEm: t };
    /** @type {import("../tipos.js").Mensagem} */
    const pergunta = { ...base, _id: randomUUID(), autor: "usuario", conteudo, status: "concluida", criadoEm: t };
    /** @type {import("../tipos.js").Mensagem} */
    const resposta = { ...base, _id: randomUUID(), autor: "bot", conteudo: "", status: "pendente", criadoEm: new Date(t.getTime() + 1) };
    await col.insertMany(/** @type {any[]} */ ([pergunta, resposta]));

    // "Oi, tudo bem?" não serve de título; espera a primeira pergunta de verdade.
    const titulo = c.titulo === "Nova conversa" && analisarConsulta(conteudo).intencao !== "conversa" ? conteudo.replace(/\s+/g, " ").slice(0, 60) : c.titulo;
    await d.collection("conversas").updateOne({ _id: /** @type {any} */ (c._id) }, { $set: { titulo, atualizadoEm: t } });

    // O evento leva tudo que o runtime precisa: ele não volta aqui para perguntar nada.
    /** @type {import("../agente/executar.js").PayloadMensagem} */
    const payload = {
      mensagemId: resposta._id,
      conversaId: c._id,
      usuarioId: u.sub,
      bot: { id: bot._id, nome: bot.nome, instrucoes: bot.instrucoes, modo: bot.modo },
      repoIds: bot.repoIds,
      historico: historico.reverse().map((m) => ({ autor: m.autor, conteudo: m.conteudo })),
      conteudo,
    };
    await publicar("mensagem.recebida", payload, { correlationId });
    return json({ pergunta: mensagemPublica(pergunta), resposta: mensagemPublica(resposta) }, 202);
  });

  // SSE autenticado por cookie (sem JWT na URL).
  //
  // O worker grava o progresso na própria mensagem (trilha, texto parcial,
  // status). Aqui olhamos a coleção a cada 350 ms e mandamos o que mudou.
  // Change streams seriam o "certo", mas exigem replica set; o polling curto
  // funciona com um mongod simples e é fácil de entender.
  r.get("/api/conversas/:id/eventos", async ({ req, res, params, correlationId }) => {
    const u = await exigirUsuario(req);
    const c = await conversaDoUsuario(u, params.id);
    const col = (await db()).collection("mensagens");

    const sse = abrirSse(res, correlationId);
    let fechado = false;
    req.on("close", () => (fechado = true));

    const limite = Date.now() + 5 * 60_000; // depois de 5 min fecha; o cliente reconecta sozinho
    let ultimoPing = Date.now();

    // Na conexão: estado atual das respostas ainda em andamento.
    const abertas = await col.find({ conversaId: c._id, status: { $in: ["pendente", "processando"] } }).toArray();
    for (const m of abertas) sse.evento("mensagem", mensagemPublica(/** @type {any} */ (m)));
    let marca = new Date();

    while (!fechado && Date.now() < limite) {
      await new Promise((ok) => setTimeout(ok, 350));
      const mudadas = await col
        .find({ conversaId: c._id, autor: "bot", atualizadoEm: { $gt: marca } })
        .sort({ atualizadoEm: 1 })
        .toArray();
      for (const m of mudadas) {
        sse.evento("mensagem", mensagemPublica(/** @type {any} */ (m)));
        if (m.atualizadoEm > marca) marca = m.atualizadoEm;
      }
      // Comentário a cada 15 s: proxies costumam derrubar conexões "mudas".
      if (Date.now() - ultimoPing > 15_000) {
        ultimoPing = Date.now();
        sse.ping();
      }
    }
    sse.fechar();
    return null; // a resposta já foi escrita pelo próprio handler
  });

  // "Ver o raciocínio": cada passo que o bot deu para responder.
  r.get("/api/execucoes/:id", async ({ req, params }) => {
    const u = await exigirUsuario(req);
    const e = await (await db()).collection("execucoes").findOne({ _id: /** @type {any} */ (params.id), ...filtroDono(u, "usuarioId") });
    if (!e) throw naoEncontrado("EXECUCAO_NAO_ENCONTRADA", "Execução não encontrada");
    const { _id, ...resto } = e;
    return json({ id: _id, ...resto });
  });
}
