import { db } from "../db.js";
import { naoEncontrado } from "../erros.js";
import { filtroDono } from "../http/auth.js";

// Carregar recurso JÁ com a autorização no filtro da consulta.
//
// Em vez de "busca o bot, depois confere se é do usuário", a consulta só
// encontra o que é do usuário. Recurso de outra pessoa responde 404, igual a
// "não existe": quem tenta ids aleatórios não descobre o que existe.

/** @typedef {import("../tipos.js").Usuario} Usuario */

/** @param {Usuario} u @param {string} id @returns {Promise<import("../tipos.js").Repositorio>} */
export async function repoDoUsuario(u, id) {
  const r = await (await db()).collection("repositorios").findOne({ _id: id, ...filtroDono(u) });
  if (!r) throw naoEncontrado("REPO_NAO_ENCONTRADO", "Repositório não encontrado");
  return /** @type {any} */ (r);
}

/** @param {Usuario} u @param {string} id @returns {Promise<import("../tipos.js").Bot>} */
export async function botDoUsuario(u, id) {
  const b = await (await db()).collection("bots").findOne({ _id: id, ...filtroDono(u) });
  if (!b) throw naoEncontrado("BOT_NAO_ENCONTRADO", "Bot não encontrado");
  return /** @type {any} */ (b);
}

/** @param {Usuario} u @param {string} id @returns {Promise<import("../tipos.js").Conversa>} */
export async function conversaDoUsuario(u, id) {
  const c = await (await db()).collection("conversas").findOne({ _id: id, ...filtroDono(u, "usuarioId") });
  if (!c) throw naoEncontrado("CONVERSA_NAO_ENCONTRADA", "Conversa não encontrada");
  return /** @type {any} */ (c);
}

// ---------- serialização ----------
// Sempre explícita, campo a campo: assim um campo novo no documento (um
// segredo, um embedding) não vaza para a resposta só porque existe.

/**
 * @param {import("../tipos.js").Repositorio} r
 * @param {boolean} [incluirSegredo] só na tela de detalhe, para configurar o webhook
 */
export function repoPublico(r, incluirSegredo = false) {
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

/** @param {import("../tipos.js").Bot} b */
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

/** @param {import("../tipos.js").Conversa} c */
export function conversaPublica(c) {
  return { id: c._id, botId: c.botId, titulo: c.titulo, criadoEm: c.criadoEm, atualizadoEm: c.atualizadoEm };
}

/** @param {import("../tipos.js").Mensagem} m */
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
