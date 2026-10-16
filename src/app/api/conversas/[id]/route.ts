import { rota, json } from "@/lib/http";
import { db } from "@/lib/db";
import { exigirUsuario } from "@/lib/auth/sessao";
import { conversaDoUsuario, conversaPublica } from "@/lib/recursos";
import type { Conversa, Mensagem } from "@/lib/tipos";

type P = { id: string };

export const GET = rota<P>(async (_r, { params }) => {
  const u = await exigirUsuario();
  return json(conversaPublica(await conversaDoUsuario(u, params.id)));
});

export const DELETE = rota<P>(async (_r, { params }) => {
  const u = await exigirUsuario();
  const c = await conversaDoUsuario(u, params.id);
  const d = await db();
  await d.collection<Mensagem>("mensagens").deleteMany({ conversaId: c._id });
  await d.collection<Conversa>("conversas").deleteOne({ _id: c._id });
  return new Response(null, { status: 204 });
});
