import { db } from "./db";
import { naoEncontrado } from "./erros";
import { filtroDono } from "./auth/sessao";
import type { Claims } from "./auth/tokens";
import type { Bot, Conversa, Repositorio } from "./tipos";

// Carregamento com autorização por recurso: recurso de outro usuário
// responde 404 (mesma resposta de "não existe").
export async function repoDoUsuario(u: Claims, id: string) {
  const r = await (await db()).collection<Repositorio>("repositorios").findOne({ _id: id, ...filtroDono(u) });
  if (!r) throw naoEncontrado("REPO_NAO_ENCONTRADO", "Repositório não encontrado");
  return r;
}

export async function botDoUsuario(u: Claims, id: string) {
  const b = await (await db()).collection<Bot>("bots").findOne({ _id: id, ...filtroDono(u) });
  if (!b) throw naoEncontrado("BOT_NAO_ENCONTRADO", "Bot não encontrado");
  return b;
}

export async function conversaDoUsuario(u: Claims, id: string) {
  const c = await (await db()).collection<Conversa>("conversas").findOne({ _id: id, ...filtroDono(u, "usuarioId") });
  if (!c) throw naoEncontrado("CONVERSA_NAO_ENCONTRADA", "Conversa não encontrada");
  return c;
}

// Serialização explícita: nunca devolver webhookSecret, embeddings ou hashes.
export function repoPublico(r: Repositorio, incluirSegredo = false) {
  return {
    id: r._id,
    url: r.url,
    ghOwner: r.ghOwner,
    ghNome: r.ghNome,
    branch: r.branch,
    status: r.status,
    ultimoCommit: r.ultimoCommit,
    erro: r.erro,
    totalArquivos: r.totalArquivos,
    totalChunks: r.totalChunks,
    progresso: r.progresso,
    ultimaIndexacao: r.ultimaIndexacao,
    criadoEm: r.criadoEm,
    atualizadoEm: r.atualizadoEm,
    ...(incluirSegredo ? { webhookSecret: r.webhookSecret } : {}),
  };
}

export function botPublico(b: Bot) {
  return { id: b._id, nome: b.nome, avatarSeed: b.avatarSeed, avatarEstilo: b.avatarEstilo ?? "pixelart", instrucoes: b.instrucoes, modo: b.modo, repoIds: b.repoIds, criadoEm: b.criadoEm, atualizadoEm: b.atualizadoEm };
}

export function conversaPublica(c: Conversa) {
  return { id: c._id, botId: c.botId, titulo: c.titulo, criadoEm: c.criadoEm, atualizadoEm: c.atualizadoEm };
}
