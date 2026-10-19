import { randomUUID } from "node:crypto";
import { db, agora } from "../db.js";

// Fila sobre o próprio MongoDB (coleção `eventos`).
//
// Mantém os conceitos do context.md (envelope, retry com backoff, DLQ e
// idempotência) sem exigir RabbitMQ. E tem um bônus: a coleção funciona como
// "outbox". O evento é gravado no mesmo banco que o efeito (ex.: a mensagem
// pendente), então não existe o problema de gravar no banco e o broker cair
// antes de publicar (dual-write).
//
// Ciclo de vida de um evento:
//   pendente ──reivindicar──► processando ──ok──► feito
//      ▲                          │
//      └──── erro (com atraso) ◄──┤
//                                 └── erro permanente / tentativas esgotadas ──► dlq

/** @typedef {import("../tipos.js").Evento} Evento */

export const BACKOFF_S = [5, 30, 120]; // atraso antes da 2ª, 3ª e 4ª tentativa
export const MAX_TENTATIVAS = BACKOFF_S.length + 1;

/**
 * Grava um evento novo na fila.
 * @param {string} tipo ex.: "repo.cadastrado"
 * @param {Record<string, unknown>} payload
 * @param {{ correlationId: string, produtor?: string, eventId?: string }} o
 *   eventId fixo serve para idempotência na entrada (ex.: delivery id do GitHub)
 * @returns {Promise<string>} o eventId
 */
export async function publicar(tipo, payload, o) {
  /** @type {Evento} */
  const ev = {
    _id: o.eventId ?? randomUUID(),
    tipo,
    versao: 1,
    ocorridoEm: agora(),
    correlationId: o.correlationId,
    produtor: o.produtor ?? "api",
    payload,
    status: "pendente",
    tentativas: 0,
    disponivelEm: agora(),
    travadoAte: null,
    trava: null,
    ultimoErro: null,
  };
  await (await db()).collection("eventos").insertOne(/** @type {any} */ (ev));
  return ev._id;
}

// Reivindicar = "pegar um evento para mim".
//
// findOneAndUpdate é atômico por documento no MongoDB: dois workers (mesmo em
// processos diferentes) nunca ficam com o mesmo evento. O encadeamento de
// promises abaixo funciona como um mutex local e serializa as reivindicações
// dentro do processo, o que mantém a garantia até em backends compatíveis que
// não são atômicos (ex.: FerretDB).
//
// A "trava" tem validade: se o worker morrer no meio, o evento volta a ficar
// disponível quando travadoAte vencer.
let anterior = Promise.resolve();

/**
 * @param {string[]} tipos
 * @param {number} travaMs por quanto tempo o evento fica reservado para este worker
 * @returns {Promise<Evento | null>}
 */
export function reivindicar(tipos, travaMs) {
  const r = anterior.then(() => reivindicarAgora(tipos, travaMs));
  anterior = r.then(
    () => {},
    () => {},
  );
  return r;
}

/** @param {string[]} tipos @param {number} travaMs */
async function reivindicarAgora(tipos, travaMs) {
  const col = (await db()).collection("eventos");
  const t = agora();
  const ev = await col.findOneAndUpdate(
    {
      tipo: { $in: tipos },
      $or: [
        { status: "pendente", disponivelEm: { $lte: t } },
        { status: "processando", travadoAte: { $lt: t } }, // worker anterior morreu
      ],
    },
    { $set: { status: "processando", trava: randomUUID(), travadoAte: new Date(t.getTime() + travaMs) }, $inc: { tentativas: 1 } },
    { sort: { disponivelEm: 1 }, returnDocument: "after" },
  );
  return /** @type {Evento | null} */ (/** @type {unknown} */ (ev));
}

/** @param {string} id */
export async function concluir(id) {
  await (await db()).collection("eventos").updateOne({ _id: /** @type {any} */ (id) }, { $set: { status: "feito", travadoAte: null } });
}

/**
 * Erro transitório: volta para "pendente" com atraso crescente, ou vai para a
 * DLQ se as tentativas acabaram.
 * @param {Evento} ev
 * @param {string} erro
 * @returns {Promise<"retry" | "dlq">}
 */
export async function reagendar(ev, erro) {
  const col = (await db()).collection("eventos");
  if (ev.tentativas >= MAX_TENTATIVAS) {
    await col.updateOne({ _id: /** @type {any} */ (ev._id) }, { $set: { status: "dlq", travadoAte: null, ultimoErro: erro } });
    return "dlq";
  }
  const atraso = BACKOFF_S[ev.tentativas - 1] * 1000;
  await col.updateOne(
    { _id: /** @type {any} */ (ev._id) },
    { $set: { status: "pendente", travadoAte: null, ultimoErro: erro, disponivelEm: new Date(Date.now() + atraso) } },
  );
  return "retry";
}

/** @param {Evento} ev @param {string} erro */
export async function mandarParaDlq(ev, erro) {
  await (await db()).collection("eventos").updateOne({ _id: /** @type {any} */ (ev._id) }, { $set: { status: "dlq", travadoAte: null, ultimoErro: erro } });
}

// Idempotência: o par (eventId, consumidor) tem índice único em
// `eventos_processados`. A fila entrega "pelo menos uma vez"; se o mesmo
// evento chegar de novo (retry depois de um timeout, reentrega do GitHub),
// o worker vê que já processou e só confirma.

/** @param {string} eventId @param {string} consumidor */
export async function jaProcessado(eventId, consumidor) {
  const n = await (await db()).collection("eventos_processados").countDocuments({ eventId, consumidor }, { limit: 1 });
  return n > 0;
}

/** @param {Pick<Evento, "_id" | "tipo">} ev @param {string} consumidor */
export async function marcarProcessado(ev, consumidor) {
  try {
    await (await db()).collection("eventos_processados").insertOne({ eventId: ev._id, consumidor, tipo: ev.tipo, processadoEm: agora() });
  } catch (e) {
    if (/** @type {{ code?: number }} */ (e).code !== 11000) throw e; // 11000 = duplicata = já marcado
  }
}
