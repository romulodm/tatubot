import { randomUUID } from "node:crypto";
import { db, agora } from "../db.js";
import { invalido } from "../erros.js";
import { exigirUsuario, filtroDono } from "../http/auth.js";
import { lerJson } from "../http/corpo.js";
import { json, semConteudo } from "../http/responder.js";
import { listaIds, texto } from "../http/validar.js";
import { conferirRepos, lerBot } from "../dominio/bots.js";
import { botDoUsuario, botPublico, conversaPublica } from "../dominio/recursos.js";

// Bots: nome, instruções, modo (pipeline/agente) e os repositórios que podem ler.

/** @param {import("../http/roteador.js").Roteador} r */
export function rotasBots(r) {
  r.get("/api/bots", async ({ req }) => {
    const u = await exigirUsuario(req);
    const itens = await (await db()).collection("bots").find(filtroDono(u)).sort({ criadoEm: 1 }).toArray();
    return json({ itens: itens.map((b) => botPublico(/** @type {any} */ (b))) });
  });

  r.post("/api/bots", async ({ req }) => {
    const u = await exigirUsuario(req);
    const dados = await lerBot(u, await lerJson(req), true);
    /** @type {import("../tipos.js").Bot} */
    const bot = {
      _id: randomUUID(),
      ownerId: u.sub,
      nome: /** @type {string} */ (dados.nome),
      avatarSeed: dados.avatarSeed ?? randomUUID(),
      avatarEstilo: dados.avatarEstilo ?? "pixelart",
      instrucoes: dados.instrucoes ?? "",
      modo: dados.modo ?? "pipeline",
      repoIds: dados.repoIds ?? [],
      criadoEm: agora(),
      atualizadoEm: agora(),
    };
    await (await db()).collection("bots").insertOne(/** @type {any} */ (bot));
    return json(botPublico(bot), 201);
  });

  r.get("/api/bots/:id", async ({ req, params }) => {
    const u = await exigirUsuario(req);
    return json(botPublico(await botDoUsuario(u, params.id)));
  });

  r.patch("/api/bots/:id", async ({ req, params }) => {
    const u = await exigirUsuario(req);
    const b = await botDoUsuario(u, params.id);
    const dados = await lerBot(u, await lerJson(req), false);
    // Só grava o que veio na requisição (undefined = "não mexer").
    const set = Object.fromEntries(Object.entries(dados).filter(([, v]) => v !== undefined));
    await (await db()).collection("bots").updateOne({ _id: /** @type {any} */ (b._id) }, { $set: { ...set, atualizadoEm: agora() } });
    return json(botPublico({ ...b, ...set }));
  });

  // Apagar o bot leva junto as conversas e mensagens dele.
  r.delete("/api/bots/:id", async ({ req, params }) => {
    const u = await exigirUsuario(req);
    const b = await botDoUsuario(u, params.id);
    const d = await db();
    const conversas = await d
      .collection("conversas")
      .find({ botId: b._id }, { projection: { _id: 1 } })
      .toArray();
    await d.collection("mensagens").deleteMany({ conversaId: { $in: conversas.map((c) => c._id) } });
    await d.collection("conversas").deleteMany({ botId: b._id });
    await d.collection("bots").deleteOne({ _id: /** @type {any} */ (b._id) });
    return semConteudo();
  });

  // Trocar só a lista de repositórios do bot.
  r.put("/api/bots/:id/repos", async ({ req, params }) => {
    const u = await exigirUsuario(req);
    const b = await botDoUsuario(u, params.id);
    const repoIds = listaIds(await lerJson(req), "repoIds", "Repositórios");
    if (!repoIds) throw invalido("repoIds é obrigatório", { campo: "repoIds" });
    await conferirRepos(u, repoIds);
    await (await db()).collection("bots").updateOne({ _id: /** @type {any} */ (b._id) }, { $set: { repoIds, atualizadoEm: agora() } });
    return json(botPublico({ ...b, repoIds }));
  });

  r.post("/api/bots/:id/conversas", async ({ req, params }) => {
    const u = await exigirUsuario(req);
    const b = await botDoUsuario(u, params.id);
    const titulo = texto(await lerJson(req), "titulo", { nome: "Título", max: 120 }) ?? "Nova conversa";
    /** @type {import("../tipos.js").Conversa} */
    const c = { _id: randomUUID(), botId: b._id, usuarioId: u.sub, titulo, criadoEm: agora(), atualizadoEm: agora() };
    await (await db()).collection("conversas").insertOne(/** @type {any} */ (c));
    return json(conversaPublica(c), 201);
  });
}
