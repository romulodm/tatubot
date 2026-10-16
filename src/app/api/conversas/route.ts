import { rota, json } from "@/lib/http";
import { db } from "@/lib/db";
import { exigirUsuario, filtroDono } from "@/lib/auth/sessao";
import { conversaPublica } from "@/lib/recursos";
import type { Conversa } from "@/lib/tipos";

export const GET = rota(async (req) => {
  const u = await exigirUsuario();
  const botId = new URL(req.url).searchParams.get("botId");
  const filtro: Record<string, unknown> = { ...filtroDono(u, "usuarioId") };
  if (botId) filtro.botId = botId;
  const itens = await (await db()).collection<Conversa>("conversas").find(filtro).sort({ atualizadoEm: -1 }).limit(100).toArray();
  return json({ itens: itens.map(conversaPublica) });
});
