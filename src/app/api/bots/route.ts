import { randomUUID } from "node:crypto";
import { rota, json, lerJson } from "@/lib/http";
import { db, agora } from "@/lib/db";
import { exigirUsuario, filtroDono } from "@/lib/auth/sessao";
import { botPublico } from "@/lib/recursos";
import { lerBot } from "@/lib/bots";
import type { Bot } from "@/lib/tipos";

export const GET = rota(async () => {
  const u = await exigirUsuario();
  const itens = await (await db()).collection<Bot>("bots").find(filtroDono(u)).sort({ criadoEm: 1 }).toArray();
  return json({ itens: itens.map(botPublico) });
});

export const POST = rota(async (req) => {
  const u = await exigirUsuario();
  const dados = await lerBot(u, await lerJson(req), true);
  const bot: Bot = {
    _id: randomUUID(),
    ownerId: u.sub,
    nome: dados.nome!,
    avatarSeed: dados.avatarSeed ?? randomUUID(),
    avatarEstilo: dados.avatarEstilo ?? "pixelart",
    instrucoes: dados.instrucoes ?? "",
    modo: dados.modo ?? "pipeline",
    repoIds: dados.repoIds ?? [],
    criadoEm: agora(),
    atualizadoEm: agora(),
  };
  await (await db()).collection<Bot>("bots").insertOne(bot);
  return json(botPublico(bot), 201);
});
