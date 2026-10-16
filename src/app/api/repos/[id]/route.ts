import { rota, json, lerJson } from "@/lib/http";
import { db, agora } from "@/lib/db";
import { texto, REGEX_BRANCH } from "@/lib/validar";
import { exigirUsuario } from "@/lib/auth/sessao";
import { publicar } from "@/lib/fila/fila";
import { repoDoUsuario, repoPublico } from "@/lib/recursos";
import type { Bot, Repositorio } from "@/lib/tipos";

type P = { id: string };

export const GET = rota<P>(async (_req, { params }) => {
  const u = await exigirUsuario();
  return json(repoPublico(await repoDoUsuario(u, params.id), true));
});

export const PATCH = rota<P>(async (req, { params, correlationId }) => {
  const u = await exigirUsuario();
  const r = await repoDoUsuario(u, params.id);
  const branch = texto(await lerJson(req), "branch", { nome: "Branch", obrigatorio: true, regex: REGEX_BRANCH })!;
  if (branch === r.branch) return json(repoPublico(r, true));
  await (await db()).collection<Repositorio>("repositorios").updateOne(
    { _id: r._id },
    { $set: { branch, status: "pendente", ultimoCommit: null, totalArquivos: 0, totalChunks: 0, atualizadoEm: agora() } },
  );
  await publicar("repo.atualizado_config", { repoId: r._id, branch }, { correlationId });
  return json(repoPublico({ ...r, branch, status: "pendente" }, true));
});

export const DELETE = rota<P>(async (_req, { params, correlationId }) => {
  const u = await exigirUsuario();
  const r = await repoDoUsuario(u, params.id);
  const d = await db();
  await d.collection<Repositorio>("repositorios").deleteOne({ _id: r._id });
  await d.collection<Bot>("bots").updateMany({ repoIds: r._id }, { $pull: { repoIds: r._id } });
  // Índice e clone são limpos pelo worker, de forma assíncrona.
  await publicar("repo.removido", { repoId: r._id }, { correlationId });
  return new Response(null, { status: 204 });
});
