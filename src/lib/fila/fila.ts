import { randomUUID } from "node:crypto";
import { db, agora } from "../db";
import type { Evento } from "../tipos";

// Fila sobre o próprio MongoDB (coleção `eventos`). Mantém os conceitos do
// context.md (envelope, retry com backoff, DLQ, idempotência) sem exigir
// RabbitMQ no MVP. A coleção também funciona como outbox: o evento é gravado
// no mesmo banco que o efeito, então não há dual-write entre banco e broker.

export const BACKOFF_S = [5, 30, 120]; // atraso antes da 2ª, 3ª e 4ª tentativa
export const MAX_TENTATIVAS = BACKOFF_S.length + 1;

export interface OpcoesPublicar {
  correlationId: string;
  produtor?: string;
  eventId?: string;
}

export async function publicar<P extends Record<string, unknown>>(tipo: string, payload: P, o: OpcoesPublicar): Promise<string> {
  const ev: Evento<P> = {
    _id: o.eventId ?? randomUUID(),
    tipo,
    versao: 1,
    ocorridoEm: agora(),
    correlationId: o.correlationId,
    produtor: o.produtor ?? "web",
    payload,
    status: "pendente",
    tentativas: 0,
    disponivelEm: agora(),
    travadoAte: null,
    trava: null,
    ultimoErro: null,
  };
  await (await db()).collection<Evento<P>>("eventos").insertOne(ev as never);
  return ev._id;
}

// Reivindica um evento disponível dos tipos pedidos. No MongoDB,
// findOneAndUpdate é atômico por documento: dois workers (mesmo em processos
// diferentes) nunca ficam com o mesmo evento. O mutex local serializa as
// reivindicações dentro do processo, o que também mantém a garantia em
// backends compatíveis que não são atômicos (ex.: FerretDB usado nos testes).
// Eventos "processando" com trava vencida (worker morreu) são retomados.
let fila: Promise<unknown> = Promise.resolve();

export function reivindicar(tipos: string[], travaMs: number): Promise<Evento | null> {
  const r = fila.then(() => reivindicarAgora(tipos, travaMs));
  fila = r.catch(() => {});
  return r;
}

async function reivindicarAgora(tipos: string[], travaMs: number): Promise<Evento | null> {
  const col = (await db()).collection<Evento>("eventos");
  const t = agora();
  return col.findOneAndUpdate(
    {
      tipo: { $in: tipos },
      $or: [
        { status: "pendente", disponivelEm: { $lte: t } },
        { status: "processando", travadoAte: { $lt: t } },
      ],
    },
    { $set: { status: "processando", trava: randomUUID(), travadoAte: new Date(t.getTime() + travaMs) }, $inc: { tentativas: 1 } },
    { sort: { disponivelEm: 1 }, returnDocument: "after" },
  );
}

export async function concluir(id: string) {
  await (await db()).collection<Evento>("eventos").updateOne({ _id: id }, { $set: { status: "feito", travadoAte: null } });
}

export async function reagendar(ev: Evento, erro: string): Promise<"retry" | "dlq"> {
  const col = (await db()).collection<Evento>("eventos");
  if (ev.tentativas >= MAX_TENTATIVAS) {
    await col.updateOne({ _id: ev._id }, { $set: { status: "dlq", travadoAte: null, ultimoErro: erro } });
    return "dlq";
  }
  const atraso = BACKOFF_S[ev.tentativas - 1] * 1000;
  await col.updateOne(
    { _id: ev._id },
    { $set: { status: "pendente", travadoAte: null, ultimoErro: erro, disponivelEm: new Date(Date.now() + atraso) } },
  );
  return "retry";
}

export async function mandarParaDlq(ev: Evento, erro: string) {
  await (await db()).collection<Evento>("eventos").updateOne({ _id: ev._id }, { $set: { status: "dlq", travadoAte: null, ultimoErro: erro } });
}

// Idempotência: (eventId, consumidor) é único. Se já existe, o efeito já
// foi aplicado e o worker só confirma.
export async function jaProcessado(eventId: string, consumidor: string): Promise<boolean> {
  const n = await (await db()).collection("eventos_processados").countDocuments({ eventId, consumidor }, { limit: 1 });
  return n > 0;
}

export async function marcarProcessado(ev: Evento, consumidor: string) {
  try {
    await (await db()).collection("eventos_processados").insertOne({ eventId: ev._id, consumidor, tipo: ev.tipo, processadoEm: agora() });
  } catch (e) {
    if ((e as { code?: number }).code !== 11000) throw e; // duplicata = já marcado
  }
}
