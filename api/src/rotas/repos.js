import { randomBytes, randomUUID } from "node:crypto";
import { db, agora } from "../db.js";
import { ErroApp } from "../erros.js";
import { exigirUsuario, filtroDono } from "../http/auth.js";
import { lerJson } from "../http/corpo.js";
import { limitar } from "../http/limite.js";
import { json, paginacao, semConteudo } from "../http/responder.js";
import { texto, REGEX_BRANCH, REGEX_REPO_URL } from "../http/validar.js";
import { publicar } from "../fila/fila.js";
import { buscar } from "../busca/buscar.js";
import { repoDoUsuario, repoPublico } from "../dominio/recursos.js";

// Repositórios: cadastrar, listar, ver, trocar branch, sincronizar, remover.
//
// Repare que nenhuma rota indexa nada. Elas gravam o estado e publicam um
// evento ("repo.cadastrado", "repo.sincronizar"...) e o worker faz o trabalho
// pesado. A requisição volta na hora; o progresso aparece na tela pelo
// polling da lista.

/** @param {import("../http/roteador.js").Roteador} r */
export function rotasRepos(r) {
  r.get("/api/repos", async ({ req, url }) => {
    const u = await exigirUsuario(req);
    const { limite, pular, pagina } = paginacao(url);
    const col = (await db()).collection("repositorios");
    const filtro = filtroDono(u);
    const [itens, total] = await Promise.all([col.find(filtro).sort({ criadoEm: -1 }).skip(pular).limit(limite).toArray(), col.countDocuments(filtro)]);
    return json({ itens: itens.map((x) => repoPublico(/** @type {any} */ (x))), pagina, limite, total });
  });

  r.post("/api/repos", async ({ req, correlationId }) => {
    const u = await exigirUsuario(req);
    const c = await lerJson(req);
    const url = /** @type {string} */ (texto(c, "url", { nome: "URL", obrigatorio: true, max: 300, regex: REGEX_REPO_URL }));
    // Sem branch: usa a padrão do repositório, descoberta no clone.
    const branch = texto(c, "branch", { nome: "Branch", max: 100, regex: REGEX_BRANCH }) ?? "";
    const [, ghOwner, ghNome] = /** @type {RegExpExecArray} */ (REGEX_REPO_URL.exec(url));

    /** @type {import("../tipos.js").Repositorio} */
    const repo = {
      _id: randomUUID(),
      ownerId: u.sub,
      // A URL é REMONTADA a partir das partes validadas, nunca usada como veio.
      url: `https://github.com/${ghOwner}/${ghNome}.git`,
      ghOwner,
      ghNome,
      branch,
      status: "pendente",
      ultimoCommit: null,
      erro: null,
      // Segredo do webhook do GitHub: aleatório, por repositório.
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
      await (await db()).collection("repositorios").insertOne(/** @type {any} */ (repo));
    } catch (e) {
      if (/** @type {{ code?: number }} */ (e).code === 11000) throw new ErroApp(409, "REPO_DUPLICADO", "Você já cadastrou este repositório nesta branch");
      throw e;
    }
    await publicar("repo.cadastrado", { repoId: repo._id, ownerId: u.sub, url: repo.url, branch }, { correlationId });
    return json(repoPublico(repo, true), 201);
  });

  r.get("/api/repos/:id", async ({ req, params }) => {
    const u = await exigirUsuario(req);
    return json(repoPublico(await repoDoUsuario(u, params.id), true));
  });

  // Trocar de branch = começar do zero (o índice antigo é de outro código).
  r.patch("/api/repos/:id", async ({ req, params, correlationId }) => {
    const u = await exigirUsuario(req);
    const repo = await repoDoUsuario(u, params.id);
    const branch = /** @type {string} */ (texto(await lerJson(req), "branch", { nome: "Branch", obrigatorio: true, regex: REGEX_BRANCH }));
    if (branch === repo.branch) return json(repoPublico(repo, true));
    const repos = (await db()).collection("repositorios");
    const reset = { branch, status: "pendente", ultimoCommit: null, totalArquivos: 0, totalChunks: 0, atualizadoEm: agora() };
    await repos.updateOne({ _id: /** @type {any} */ (repo._id) }, { $set: reset });
    await publicar("repo.atualizado_config", { repoId: repo._id, branch }, { correlationId });
    return json(repoPublico({ ...repo, branch, status: "pendente" }, true));
  });

  r.delete("/api/repos/:id", async ({ req, params, correlationId }) => {
    const u = await exigirUsuario(req);
    const repo = await repoDoUsuario(u, params.id);
    const d = await db();
    await d.collection("repositorios").deleteOne({ _id: /** @type {any} */ (repo._id) });
    await d.collection("bots").updateMany({ repoIds: repo._id }, { $pull: { repoIds: repo._id } });
    // Índice e clone são limpos pelo worker, de forma assíncrona.
    await publicar("repo.removido", { repoId: repo._id }, { correlationId });
    return semConteudo();
  });

  // Botão "sincronizar": mesma coisa que o webhook faz num push.
  r.post("/api/repos/:id/sincronizar", async ({ req, params, correlationId }) => {
    const u = await exigirUsuario(req);
    const repo = await repoDoUsuario(u, params.id);
    limitar(`sync:${repo._id}`, 6, 60_000);
    const eventId = await publicar("repo.sincronizar", { repoId: repo._id, origem: "manual" }, { correlationId });
    return json({ eventId }, 202);
  });

  // O que foi indexado e o que foi ignorado (com o motivo).
  r.get("/api/repos/:id/arquivos", async ({ req, params, url }) => {
    const u = await exigirUsuario(req);
    const repo = await repoDoUsuario(u, params.id);
    const status = url.searchParams.get("status");
    /** @type {Record<string, unknown>} */
    const filtro = { repoId: repo._id };
    if (status === "indexado" || status === "ignorado" || status === "erro") filtro.status = status;
    const col = (await db()).collection("arquivos");
    const itens = await col
      .find(filtro, { projection: { _id: 0, path: 1, status: 1, motivo: 1, linguagem: 1, tamanhoBytes: 1 } })
      .sort({ path: 1 })
      .limit(2000)
      .toArray();
    const contagem = await col.aggregate([{ $match: { repoId: repo._id } }, { $group: { _id: "$status", n: { $sum: 1 } } }]).toArray();
    return json({ itens, contagem: Object.fromEntries(contagem.map((c) => [c._id, c.n])) });
  });

  // Rota de depuração da busca: mostra o ranking com os scores de cada etapa
  // (vetorial, textual, caminho, RRF, cobertura). Ótima para entender por que
  // um trecho apareceu ou não.
  r.post("/api/repos/:id/busca", async ({ req, params }) => {
    const u = await exigirUsuario(req);
    const repo = await repoDoUsuario(u, params.id);
    const consulta = /** @type {string} */ (texto(await lerJson(req), "consulta", { nome: "Consulta", obrigatorio: true, max: 500 }));
    const { resultados, avisos } = await buscar({ repoIds: [repo._id], consulta, k: 10, grafo: true });
    return json({
      avisos,
      resultados: resultados.map((x) => ({
        path: x.chunk.path,
        simbolo: x.chunk.simbolo,
        tipo: x.chunk.tipo,
        linhaInicio: x.chunk.linhaInicio,
        linhaFim: x.chunk.linhaFim,
        commitSha: x.chunk.commitSha,
        viaGrafo: x.viaGrafo,
        scores: x.scores,
        previa: x.chunk.conteudo.split("\n").slice(0, 8).join("\n"),
      })),
    });
  });
}
