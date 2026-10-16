import { randomUUID } from "node:crypto";
import { rota, json, lerJson } from "@/lib/http";
import { db, agora } from "@/lib/db";
import { texto } from "@/lib/validar";
import { exigirUsuario } from "@/lib/auth/sessao";
import { botDoUsuario, conversaPublica } from "@/lib/recursos";
import type { Conversa } from "@/lib/tipos";

export const POST = rota<{ id: string }>(async (req, { params }) => {
  const u = await exigirUsuario();
  const b = await botDoUsuario(u, params.id);
  const titulo = texto(await lerJson(req), "titulo", { nome: "Título", max: 120 }) ?? "Nova conversa";
  const c: Conversa = { _id: randomUUID(), botId: b._id, usuarioId: u.sub, titulo, criadoEm: agora(), atualizadoEm: agora() };
  await (await db()).collection<Conversa>("conversas").insertOne(c);
  return json(conversaPublica(c), 201);
});
