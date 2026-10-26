import { randomUUID } from "node:crypto";
import { log } from "./config.js";
import { db, agora } from "./db.js";
import { ErroPermanente } from "./erros.js";
import { falhar, responder } from "./agente/executar.js";
import { indexar, limparRepo } from "./indexacao/indexar.js";

// Fila na coleção `eventos` do próprio Mongo. Como o evento fica no mesmo
// banco que o efeito, ela também faz o papel de outbox.
//
//   pendente -> processando -> feito
//      ^            |
//      +-- retry ---+--> dlq (erro permanente ou tentativas esgotadas)

export const BACKOFF_S = [5, 30, 120];
export const MAX_TENTATIVAS = BACKOFF_S.length + 1;

const eventos = async () => (await db()).collection("eventos");

export async function publicar(tipo, payload, o) {
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
  await (await eventos()).insertOne(ev);
  return ev._id;
}

// findOneAndUpdate é atômico por documento, então dois workers nunca pegam o
// mesmo evento. A corrente de promises serializa dentro do processo (ajuda em
// backends compatíveis que não são atômicos, como o FerretDB).
let anterior = Promise.resolve();

export function reivindicar(tipos, travaMs) {
  const r = anterior.then(async () => {
    const t = agora();
    return (await eventos()).findOneAndUpdate(
      {
        tipo: { $in: tipos },
        $or: [
          { status: "pendente", disponivelEm: { $lte: t } },
          // trava vencida: o worker anterior morreu no meio
          { status: "processando", travadoAte: { $lt: t } },
        ],
      },
      { $set: { status: "processando", trava: randomUUID(), travadoAte: new Date(t.getTime() + travaMs) }, $inc: { tentativas: 1 } },
      { sort: { disponivelEm: 1 }, returnDocument: "after" },
    );
  });
  anterior = r.catch(() => {});
  return r;
}

export async function concluir(id) {
  await (await eventos()).updateOne({ _id: id }, { $set: { status: "feito", travadoAte: null } });
}

export async function mandarParaDlq(ev, erro) {
  await (await eventos()).updateOne({ _id: ev._id }, { $set: { status: "dlq", travadoAte: null, ultimoErro: erro } });
}

export async function reagendar(ev, erro) {
  if (ev.tentativas >= MAX_TENTATIVAS) {
    await mandarParaDlq(ev, erro);
    return "dlq";
  }
  const disponivelEm = new Date(Date.now() + BACKOFF_S[ev.tentativas - 1] * 1000);
  await (await eventos()).updateOne({ _id: ev._id }, { $set: { status: "pendente", travadoAte: null, ultimoErro: erro, disponivelEm } });
  return "retry";
}

// A entrega é "pelo menos uma vez"; (eventId, consumidor) com índice único
// garante que cada consumidor processa o evento uma vez só.
export async function jaProcessado(eventId, consumidor) {
  return (await (await db()).collection("eventos_processados").countDocuments({ eventId, consumidor }, { limit: 1 })) > 0;
}

export async function marcarProcessado(ev, consumidor) {
  try {
    await (await db()).collection("eventos_processados").insertOne({ eventId: ev._id, consumidor, tipo: ev.tipo, processadoEm: agora() });
  } catch (e) {
    if (e.code !== 11000) throw e;
  }
}

// ---------- consumidores e worker ----------

export const consumidores = [
  {
    nome: "indexador.repos",
    tipos: ["repo.cadastrado", "repo.sincronizar", "repo.atualizado_config", "repo.removido"],
    // 1: duas sincronizações do mesmo repo nunca rodam juntas
    concorrencia: 1,
    travaMs: 15 * 60_000,
    async processar(ev) {
      const { repoId } = ev.payload;
      if (ev.tipo === "repo.removido") return limparRepo(repoId);
      if (ev.tipo === "repo.atualizado_config") await limparRepo(repoId);
      await indexar(repoId, ev.correlationId);
    },
    async aoFalharDefinitivo(ev, erro) {
      const set = { status: "erro", erro: erro.message.slice(0, 300), progresso: null, atualizadoEm: agora() };
      await (await db()).collection("repositorios").updateOne({ _id: ev.payload.repoId }, { $set: set });
    },
  },
  {
    nome: "indexador.mensagens",
    tipos: ["mensagem.recebida"],
    concorrencia: 4,
    travaMs: 5 * 60_000,
    processar: (ev) => responder(ev.payload, ev.correlationId),
    aoFalharDefinitivo: (ev, erro) => falhar(ev.payload, erro),
  },
];

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

export function iniciarWorker() {
  let ativo = true;
  const faixas = [];
  for (const c of consumidores) {
    for (let i = 0; i < c.concorrencia; i++) {
      faixas.push(
        (async () => {
          while (ativo) {
            const ev = await reivindicar(c.tipos, c.travaMs).catch((e) => log("erro", "fila indisponível", { erro: String(e) }));
            if (ev) await executar(c, ev);
            else await dormir(500);
          }
        })(),
      );
    }
  }
  log("info", "worker iniciado", { consumidores: consumidores.map((c) => `${c.nome}x${c.concorrencia}`) });

  return {
    async parar() {
      ativo = false;
      await Promise.allSettled(faixas);
      log("info", "worker parado");
    },
  };
}

async function executar(c, ev) {
  const base = { evento: ev.tipo, eventId: ev._id, correlationId: ev.correlationId, tentativa: ev.tentativas };
  try {
    if (!(await jaProcessado(ev._id, c.nome))) {
      await c.processar(ev);
      await marcarProcessado(ev, c.nome);
      log("info", "evento processado", base);
    }
    await concluir(ev._id);
  } catch (e) {
    const erro = e instanceof Error ? e : new Error(String(e));
    let destino = "dlq";
    if (erro instanceof ErroPermanente) await mandarParaDlq(ev, erro.message);
    else destino = await reagendar(ev, erro.message);

    if (destino === "retry") {
      log("aviso", "evento reagendado", { ...base, erro: erro.message });
      return;
    }
    log("erro", "evento na DLQ", { ...base, erro: erro.message });
    await c.aoFalharDefinitivo?.(ev, erro).catch(() => {});
  }
}
