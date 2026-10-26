import { db } from "../db.js";
import { naoEncontrado } from "../erros.js";
import { filtroDono } from "../auth.js";

// A autorização já vai no filtro da consulta: recurso de outra pessoa dá 404,
// igual a um que não existe.

async function buscarDoUsuario(colecao, filtro, codigo, mensagem) {
  const doc = await (await db()).collection(colecao).findOne(filtro);
  if (!doc) throw naoEncontrado(codigo, mensagem);
  return doc;
}

export const repoDoUsuario = (u, id) =>
  buscarDoUsuario("repositorios", { _id: id, ...filtroDono(u) }, "REPO_NAO_ENCONTRADO", "Repositório não encontrado");

export const botDoUsuario = (u, id) => buscarDoUsuario("bots", { _id: id, ...filtroDono(u) }, "BOT_NAO_ENCONTRADO", "Bot não encontrado");

export const conversaDoUsuario = (u, id) =>
  buscarDoUsuario("conversas", { _id: id, ...filtroDono(u, "usuarioId") }, "CONVERSA_NAO_ENCONTRADA", "Conversa não encontrada");

// Serialização campo a campo, para nada novo no documento vazar sem querer.

export function repoPublico(r, comSegredo = false) {
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
    ...(comSegredo ? { webhookSecret: r.webhookSecret } : {}),
  };
}

export function botPublico(b) {
  return {
    id: b._id,
    nome: b.nome,
    avatarSeed: b.avatarSeed,
    avatarEstilo: b.avatarEstilo ?? "pixelart",
    instrucoes: b.instrucoes,
    modo: b.modo,
    repoIds: b.repoIds,
    criadoEm: b.criadoEm,
    atualizadoEm: b.atualizadoEm,
  };
}

export function conversaPublica(c) {
  return { id: c._id, botId: c.botId, titulo: c.titulo, criadoEm: c.criadoEm, atualizadoEm: c.atualizadoEm };
}

export function mensagemPublica(m) {
  return {
    id: m._id,
    autor: m.autor,
    conteudo: m.conteudo,
    citacoes: m.citacoes,
    trilha: m.trilha,
    status: m.status,
    erro: m.erro,
    execucaoId: m.execucaoId,
    criadoEm: m.criadoEm,
    atualizadoEm: m.atualizadoEm,
  };
}
