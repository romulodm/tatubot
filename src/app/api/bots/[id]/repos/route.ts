import { rota, json, lerJson } from "@/lib/http";
import { db, agora } from "@/lib/db";
import { invalido } from "@/lib/erros";
import { listaIds } from "@/lib/validar";
import { exigirUsuario } from "@/lib/auth/sessao";
import { botDoUsuario, botPublico } from "@/lib/recursos";
import { conferirRepos } from "@/lib/bots";
import type { Bot } from "@/lib/tipos";

export const PUT = rota<{ id: string }>(async (req, { params }) => {
  const u = await exigirUsuario();
  const b = await botDoUsuario(u, params.id);
  const repoIds = listaIds(await lerJson(req), "repoIds", "Repositórios");
  if (!repoIds) throw invalido("repoIds é obrigatório", { campo: "repoIds" });
  await conferirRepos(u, repoIds);
  await (await db()).collection<Bot>("bots").updateOne({ _id: b._id }, { $set: { repoIds, atualizadoEm: agora() } });
  return json(botPublico({ ...b, repoIds }));
});
