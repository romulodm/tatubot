import { randomUUID } from "node:crypto";
import { rota, json, lerJson } from "@/lib/http";
import { db, agora } from "@/lib/db";
import { texto } from "@/lib/validar";
import { exigirUsuario } from "@/lib/auth/sessao";
import { botDoUsuario, conversaDoUsuario } from "@/lib/recursos";
import { publicar } from "@/lib/fila/fila";
import { analisarConsulta } from "@/lib/busca/consulta";
import { limitar } from "@/lib/limite";
import { mensagemPublica } from "@/lib/mensagens";
import type { PayloadMensagem } from "@/lib/agente/executar";
import type { Conversa, Mensagem } from "@/lib/tipos";

type P = { id: string };

export const GET = rota<P>(async (_r, { params }) => {
  const u = await exigirUsuario();
  const c = await conversaDoUsuario(u, params.id);
  const itens = await (await db()).collection<Mensagem>("mensagens").find({ conversaId: c._id }).sort({ criadoEm: 1 }).limit(500).toArray();
  return json({ itens: itens.map(mensagemPublica) });
});

// Envio assíncrono: grava a pergunta, cria a resposta "pendente", publica
// mensagem.recebida e devolve 202. A resposta chega pelo SSE.
export const POST = rota<P>(async (req, { params, correlationId }) => {
  const u = await exigirUsuario();
  limitar(`msg:${u.sub}`, 10, 60_000);
  const c = await conversaDoUsuario(u, params.id);
  const bot = await botDoUsuario(u, c.botId);
  const conteudo = texto(await lerJson(req), "conteudo", { nome: "Mensagem", obrigatorio: true, max: 4000 })!;

  const d = await db();
  const col = d.collection<Mensagem>("mensagens");
  const historico = await col.find({ conversaId: c._id, status: "concluida" }).sort({ criadoEm: -1 }).limit(10).toArray();

  const t = agora();
  const base = { conversaId: c._id, citacoes: [], trilha: [], erro: null, correlationId, execucaoId: null, atualizadoEm: t };
  const pergunta: Mensagem = { ...base, _id: randomUUID(), autor: "usuario", conteudo, status: "concluida", criadoEm: t };
  const resposta: Mensagem = { ...base, _id: randomUUID(), autor: "bot", conteudo: "", status: "pendente", criadoEm: new Date(t.getTime() + 1) };
  await col.insertMany([pergunta, resposta]);

  // "Oi, tudo bem?" não serve de título; espera a primeira pergunta de verdade.
  const titulo = c.titulo === "Nova conversa" && analisarConsulta(conteudo).intencao !== "conversa" ? conteudo.replace(/\s+/g, " ").slice(0, 60) : c.titulo;
  await d.collection<Conversa>("conversas").updateOne({ _id: c._id }, { $set: { titulo, atualizadoEm: t } });

  const payload: PayloadMensagem = {
    mensagemId: resposta._id,
    conversaId: c._id,
    usuarioId: u.sub,
    bot: { id: bot._id, nome: bot.nome, instrucoes: bot.instrucoes, modo: bot.modo },
    repoIds: bot.repoIds,
    historico: historico.reverse().map((m) => ({ autor: m.autor, conteudo: m.conteudo })),
    conteudo,
  };
  await publicar("mensagem.recebida", payload as unknown as Record<string, unknown>, { correlationId });
  return json({ pergunta: mensagemPublica(pergunta), resposta: mensagemPublica(resposta) }, 202);
});
