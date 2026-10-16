import { rota, json, lerJson } from "@/lib/http";
import { db, agora } from "@/lib/db";
import { exigirUsuario } from "@/lib/auth/sessao";
import { botDoUsuario, botPublico } from "@/lib/recursos";
import { lerBot } from "@/lib/bots";
import type { Bot, Conversa, Mensagem } from "@/lib/tipos";

type P = { id: string };

export const GET = rota<P>(async (_r, { params }) => {
  const u = await exigirUsuario();
  return json(botPublico(await botDoUsuario(u, params.id)));
});

export const PATCH = rota<P>(async (req, { params }) => {
  const u = await exigirUsuario();
  const b = await botDoUsuario(u, params.id);
  const dados = await lerBot(u, await lerJson(req), false);
  const set = Object.fromEntries(Object.entries(dados).filter(([, v]) => v !== undefined));
  await (await db()).collection<Bot>("bots").updateOne({ _id: b._id }, { $set: { ...set, atualizadoEm: agora() } });
  return json(botPublico({ ...b, ...set }));
});

export const DELETE = rota<P>(async (_r, { params }) => {
  const u = await exigirUsuario();
  const b = await botDoUsuario(u, params.id);
  const d = await db();
  const conversas = await d.collection<Conversa>("conversas").find({ botId: b._id }, { projection: { _id: 1 } }).toArray();
  await d.collection<Mensagem>("mensagens").deleteMany({ conversaId: { $in: conversas.map((c) => c._id) } });
  await d.collection<Conversa>("conversas").deleteMany({ botId: b._id });
  await d.collection<Bot>("bots").deleteOne({ _id: b._id });
  return new Response(null, { status: 204 });
});
