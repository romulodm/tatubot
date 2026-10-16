import { rota, json } from "@/lib/http";
import { db } from "@/lib/db";
import { naoEncontrado } from "@/lib/erros";
import { exigirUsuario, filtroDono } from "@/lib/auth/sessao";
import type { Execucao } from "@/lib/tipos";

// "Ver o raciocínio": cada passo da execução do bot.
export const GET = rota<{ id: string }>(async (_r, { params }) => {
  const u = await exigirUsuario();
  const e = await (await db()).collection<Execucao>("execucoes").findOne({ _id: params.id, ...filtroDono(u, "usuarioId") });
  if (!e) throw naoEncontrado("EXECUCAO_NAO_ENCONTRADA", "Execução não encontrada");
  const { _id, ...resto } = e;
  return json({ id: _id, ...resto });
});
