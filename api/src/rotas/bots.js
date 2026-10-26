import { randomUUID } from "node:crypto";
import { SEEDICON_STYLES } from "seedicon";
import { db, agora } from "../db.js";
import { invalido } from "../erros.js";
import { exigirUsuario, filtroDono } from "../auth.js";
import { json, lerJson, listaIds, semConteudo, texto } from "../http.js";
import { botDoUsuario, botPublico, conversaPublica } from "./recursos.js";

export function rotasBots(r) {
  r.get("/api/bots", async ({ req }) => {
    const u = await exigirUsuario(req);
    const itens = await (await db()).collection("bots").find(filtroDono(u)).sort({ criadoEm: 1 }).toArray();
    return json({ itens: itens.map(botPublico) });
  });

  r.post("/api/bots", async ({ req }) => {
    const u = await exigirUsuario(req);
    const dados = await lerBot(u, await lerJson(req), true);
    const bot = {
      _id: randomUUID(),
      ownerId: u.sub,
      nome: dados.nome,
      avatarSeed: dados.avatarSeed ?? randomUUID(),
      avatarEstilo: dados.avatarEstilo ?? "pixelart",
      instrucoes: dados.instrucoes ?? "",
      modo: dados.modo ?? "pipeline",
      repoIds: dados.repoIds ?? [],
      criadoEm: agora(),
      atualizadoEm: agora(),
    };
    await (await db()).collection("bots").insertOne(bot);
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
    const set = Object.fromEntries(Object.entries(dados).filter(([, v]) => v !== undefined));
    await (await db()).collection("bots").updateOne({ _id: b._id }, { $set: { ...set, atualizadoEm: agora() } });
    return json(botPublico({ ...b, ...set }));
  });

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
    await d.collection("bots").deleteOne({ _id: b._id });
    return semConteudo();
  });

  r.put("/api/bots/:id/repos", async ({ req, params }) => {
    const u = await exigirUsuario(req);
    const b = await botDoUsuario(u, params.id);
    const repoIds = listaIds(await lerJson(req), "repoIds", "Repositórios");
    if (!repoIds) throw invalido("repoIds é obrigatório", { campo: "repoIds" });
    await conferirRepos(u, repoIds);
    await (await db()).collection("bots").updateOne({ _id: b._id }, { $set: { repoIds, atualizadoEm: agora() } });
    return json(botPublico({ ...b, repoIds }));
  });

  r.post("/api/bots/:id/conversas", async ({ req, params }) => {
    const u = await exigirUsuario(req);
    const b = await botDoUsuario(u, params.id);
    const titulo = texto(await lerJson(req), "titulo", { nome: "Título", max: 120 }) ?? "Nova conversa";
    const c = { _id: randomUUID(), botId: b._id, usuarioId: u.sub, titulo, criadoEm: agora(), atualizadoEm: agora() };
    await (await db()).collection("conversas").insertOne(c);
    return json(conversaPublica(c), 201);
  });
}

// No POST o nome é obrigatório; no PATCH só vem o que mudou.
async function lerBot(u, c, criando) {
  const dados = {
    nome: texto(c, "nome", { nome: "Nome", obrigatorio: criando, min: 2, max: 40 }),
    // "" é a pessoa apagando as instruções, diferente de não mandar o campo
    instrucoes: c.instrucoes === "" ? "" : texto(c, "instrucoes", { nome: "Instruções", max: 4000 }),
    modo: texto(c, "modo", { nome: "Modo", valores: ["pipeline", "agente"] }),
    avatarSeed: texto(c, "avatarSeed", { nome: "Avatar", max: 80 }),
    avatarEstilo: texto(c, "avatarEstilo", { nome: "Estilo do avatar", valores: SEEDICON_STYLES }),
    repoIds: listaIds(c, "repoIds", "Repositórios"),
  };
  if (dados.repoIds?.length) await conferirRepos(u, dados.repoIds);
  return dados;
}

// bot só lê repositório do próprio dono
async function conferirRepos(u, repoIds) {
  const n = await (await db()).collection("repositorios").countDocuments({ _id: { $in: repoIds }, ownerId: u.sub });
  if (n !== repoIds.length) throw invalido("Algum repositório não existe ou não é seu", { campo: "repoIds" });
}
