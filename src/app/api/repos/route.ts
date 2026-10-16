import { randomBytes, randomUUID } from "node:crypto";
import { rota, json, lerJson, paginacao } from "@/lib/http";
import { db, agora } from "@/lib/db";
import { ErroApp } from "@/lib/erros";
import { texto, REGEX_BRANCH, REGEX_REPO_URL } from "@/lib/validar";
import { exigirUsuario, filtroDono } from "@/lib/auth/sessao";
import { publicar } from "@/lib/fila/fila";
import { repoPublico } from "@/lib/recursos";
import type { Repositorio } from "@/lib/tipos";

export const GET = rota(async (req) => {
  const u = await exigirUsuario();
  const { limite, pular, pagina } = paginacao(new URL(req.url));
  const col = (await db()).collection<Repositorio>("repositorios");
  const filtro = filtroDono(u);
  const [itens, total] = await Promise.all([col.find(filtro).sort({ criadoEm: -1 }).skip(pular).limit(limite).toArray(), col.countDocuments(filtro)]);
  return json({ itens: itens.map((r) => repoPublico(r)), pagina, limite, total });
});

export const POST = rota(async (req, { correlationId }) => {
  const u = await exigirUsuario();
  const c = await lerJson(req);
  const url = texto(c, "url", { nome: "URL", obrigatorio: true, max: 300, regex: REGEX_REPO_URL })!;
  // Sem branch: usa a padrão do repositório, descoberta no clone.
  const branch = texto(c, "branch", { nome: "Branch", max: 100, regex: REGEX_BRANCH }) ?? "";
  const [, ghOwner, ghNome] = REGEX_REPO_URL.exec(url)!;

  const repo: Repositorio = {
    _id: randomUUID(),
    ownerId: u.sub,
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
    await (await db()).collection<Repositorio>("repositorios").insertOne(repo);
  } catch (e) {
    if ((e as { code?: number }).code === 11000) throw new ErroApp(409, "REPO_DUPLICADO", "Você já cadastrou este repositório nesta branch");
    throw e;
  }
  await publicar("repo.cadastrado", { repoId: repo._id, ownerId: u.sub, url: repo.url, branch }, { correlationId });
  return json(repoPublico(repo, true), 201);
});
