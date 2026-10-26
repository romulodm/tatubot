import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { db, agora } from "../db.js";
import { ErroApp } from "../erros.js";
import { exigirUsuario, filtroDono } from "../auth.js";
import { json, lerJson, lerTexto, limitar, paginacao, semConteudo, texto, REGEX_BRANCH, REGEX_REPO_URL } from "../http.js";
import { publicar } from "../fila.js";
import { buscar } from "../busca/buscar.js";
import { repoDoUsuario, repoPublico } from "./recursos.js";

// As rotas só gravam o estado e publicam um evento; quem clona e indexa é o worker.

export function rotasRepos(r) {
  r.get("/api/repos", async ({ req, url }) => {
    const u = await exigirUsuario(req);
    const { limite, pular, pagina } = paginacao(url);
    const col = (await db()).collection("repositorios");
    const filtro = filtroDono(u);
    const [itens, total] = await Promise.all([
      col.find(filtro).sort({ criadoEm: -1 }).skip(pular).limit(limite).toArray(),
      col.countDocuments(filtro),
    ]);
    return json({ itens: itens.map((x) => repoPublico(x)), pagina, limite, total });
  });

  r.post("/api/repos", async ({ req, correlationId }) => {
    const u = await exigirUsuario(req);
    const c = await lerJson(req);
    const url = texto(c, "url", { nome: "URL", obrigatorio: true, max: 300, regex: REGEX_REPO_URL });
    // vazio = branch padrão do repositório, descoberta no clone
    const branch = texto(c, "branch", { nome: "Branch", max: 100, regex: REGEX_BRANCH }) ?? "";
    const [, ghOwner, ghNome] = REGEX_REPO_URL.exec(url);

    const repo = {
      _id: randomUUID(),
      ownerId: u.sub,
      // remontada a partir das partes validadas, nunca usada como veio
      url: `https://github.com/${ghOwner}/${ghNome}.git`,
      ghOwner,
      ghNome,
      branch,
      status: "pendente",
      ultimoCommit: null,
      erro: null,
      webhookSecret: randomBytes(24).toString("base64url"),
      totalArquivos: 0,
      totalChunks: 0,
      embedModelo: null,
      versaoIndice: 0,
      progresso: null,
      ultimaIndexacao: null,
      criadoEm: agora(),
      atualizadoEm: agora(),
    };
    try {
      await (await db()).collection("repositorios").insertOne(repo);
    } catch (e) {
      if (e.code === 11000) throw new ErroApp(409, "REPO_DUPLICADO", "Você já cadastrou este repositório nesta branch");
      throw e;
    }
    await publicar("repo.cadastrado", { repoId: repo._id, ownerId: u.sub, url: repo.url, branch }, { correlationId });
    return json(repoPublico(repo, true), 201);
  });

  r.get("/api/repos/:id", async ({ req, params }) => {
    const u = await exigirUsuario(req);
    return json(repoPublico(await repoDoUsuario(u, params.id), true));
  });

  // trocar de branch = indexar do zero
  r.patch("/api/repos/:id", async ({ req, params, correlationId }) => {
    const u = await exigirUsuario(req);
    const repo = await repoDoUsuario(u, params.id);
    const branch = texto(await lerJson(req), "branch", { nome: "Branch", obrigatorio: true, regex: REGEX_BRANCH });
    if (branch === repo.branch) return json(repoPublico(repo, true));
    const reset = { branch, status: "pendente", ultimoCommit: null, totalArquivos: 0, totalChunks: 0, atualizadoEm: agora() };
    await (await db()).collection("repositorios").updateOne({ _id: repo._id }, { $set: reset });
    await publicar("repo.atualizado_config", { repoId: repo._id, branch }, { correlationId });
    return json(repoPublico({ ...repo, ...reset }, true));
  });

  r.delete("/api/repos/:id", async ({ req, params, correlationId }) => {
    const u = await exigirUsuario(req);
    const repo = await repoDoUsuario(u, params.id);
    const d = await db();
    await d.collection("repositorios").deleteOne({ _id: repo._id });
    await d.collection("bots").updateMany({ repoIds: repo._id }, { $pull: { repoIds: repo._id } });
    await publicar("repo.removido", { repoId: repo._id }, { correlationId });
    return semConteudo();
  });

  r.post("/api/repos/:id/sincronizar", async ({ req, params, correlationId }) => {
    const u = await exigirUsuario(req);
    const repo = await repoDoUsuario(u, params.id);
    limitar(`sync:${repo._id}`, 6, 60_000);
    const eventId = await publicar("repo.sincronizar", { repoId: repo._id, origem: "manual" }, { correlationId });
    return json({ eventId }, 202);
  });

  r.get("/api/repos/:id/arquivos", async ({ req, params, url }) => {
    const u = await exigirUsuario(req);
    const repo = await repoDoUsuario(u, params.id);
    const status = url.searchParams.get("status");
    const filtro = { repoId: repo._id };
    if (["indexado", "ignorado", "erro"].includes(status)) filtro.status = status;
    const col = (await db()).collection("arquivos");
    const itens = await col
      .find(filtro, { projection: { _id: 0, path: 1, status: 1, motivo: 1, linguagem: 1, tamanhoBytes: 1 } })
      .sort({ path: 1 })
      .limit(2000)
      .toArray();
    const contagem = await col.aggregate([{ $match: { repoId: repo._id } }, { $group: { _id: "$status", n: { $sum: 1 } } }]).toArray();
    return json({ itens, contagem: Object.fromEntries(contagem.map((c) => [c._id, c.n])) });
  });

  // depuração: o ranking com o score de cada etapa da busca
  r.post("/api/repos/:id/busca", async ({ req, params }) => {
    const u = await exigirUsuario(req);
    const repo = await repoDoUsuario(u, params.id);
    const consulta = texto(await lerJson(req), "consulta", { nome: "Consulta", obrigatorio: true, max: 500 });
    const { resultados, avisos } = await buscar({ repoIds: [repo._id], consulta, k: 10, grafo: true });
    return json({
      avisos,
      resultados: resultados.map(({ chunk, viaGrafo, scores }) => ({
        path: chunk.path,
        simbolo: chunk.simbolo,
        tipo: chunk.tipo,
        linhaInicio: chunk.linhaInicio,
        linhaFim: chunk.linhaFim,
        commitSha: chunk.commitSha,
        viaGrafo,
        scores,
        previa: chunk.conteudo.split("\n").slice(0, 8).join("\n"),
      })),
    });
  });

  // Webhook do GitHub. Rota pública: quem autentica é o HMAC do corpo.
  r.post("/api/webhooks/github/:repoId", async ({ req, params, correlationId }) => {
    const corpo = await lerTexto(req, 1024 * 1024);
    const assinatura = String(req.headers["x-hub-signature-256"] ?? "");
    const repo = await (await db()).collection("repositorios").findOne({ _id: params.repoId });
    if (!repo || !assinaturaValida(corpo, assinatura, repo.webhookSecret)) {
      throw new ErroApp(401, "ASSINATURA_INVALIDA", "Assinatura do webhook inválida");
    }
    const evento = req.headers["x-github-event"];
    if (evento === "ping") return json({ ok: true });
    if (evento !== "push") return json({ ignorado: evento }, 202);

    let push;
    try {
      push = JSON.parse(corpo);
    } catch {
      throw new ErroApp(400, "JSON_INVALIDO", "Corpo do webhook inválido");
    }
    const ref = push.ref ?? "";
    if (ref !== `refs/heads/${repo.branch}`) return json({ ignorado: `push em ${ref}` }, 202);

    // o delivery id como eventId deixa a reentrega do GitHub idempotente
    const delivery = req.headers["x-github-delivery"];
    try {
      await publicar(
        "repo.sincronizar",
        { repoId: repo._id, origem: "webhook", commitAlvo: push.after },
        { correlationId, eventId: typeof delivery === "string" ? delivery : undefined, produtor: "github" },
      );
    } catch (e) {
      if (e.code !== 11000) throw e;
    }
    return json({ ok: true }, 202);
  });
}

export function assinaturaValida(corpo, assinatura, segredo) {
  const esperado = Buffer.from("sha256=" + createHmac("sha256", segredo).update(corpo).digest("hex"));
  const recebido = Buffer.from(assinatura);
  return esperado.length === recebido.length && timingSafeEqual(esperado, recebido);
}
