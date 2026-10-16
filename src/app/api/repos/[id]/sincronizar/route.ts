import { rota, json } from "@/lib/http";
import { exigirUsuario } from "@/lib/auth/sessao";
import { publicar } from "@/lib/fila/fila";
import { repoDoUsuario } from "@/lib/recursos";
import { limitar } from "@/lib/limite";

export const POST = rota<{ id: string }>(async (_req, { params, correlationId }) => {
  const u = await exigirUsuario();
  const r = await repoDoUsuario(u, params.id);
  limitar(`sync:${r._id}`, 6, 60_000);
  const eventId = await publicar("repo.sincronizar", { repoId: r._id, origem: "manual" }, { correlationId });
  return json({ eventId }, 202);
});
