import { rota, json } from "@/lib/http";
import { db } from "@/lib/db";
import { exigirUsuario } from "@/lib/auth/sessao";
import { repoDoUsuario } from "@/lib/recursos";
import type { Arquivo } from "@/lib/tipos";

export const GET = rota<{ id: string }>(async (req, { params }) => {
  const u = await exigirUsuario();
  const r = await repoDoUsuario(u, params.id);
  const status = new URL(req.url).searchParams.get("status");
  const filtro: Record<string, unknown> = { repoId: r._id };
  if (status === "indexado" || status === "ignorado" || status === "erro") filtro.status = status;
  const itens = await (await db()).collection<Arquivo>("arquivos").find(filtro, { projection: { _id: 0, path: 1, status: 1, motivo: 1, linguagem: 1, tamanhoBytes: 1 } }).sort({ path: 1 }).limit(2000).toArray();
  const contagem = await (await db()).collection<Arquivo>("arquivos").aggregate<{ _id: string; n: number }>([{ $match: { repoId: r._id } }, { $group: { _id: "$status", n: { $sum: 1 } } }]).toArray();
  return json({ itens, contagem: Object.fromEntries(contagem.map((c) => [c._id, c.n])) });
});
