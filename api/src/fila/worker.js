import { ErroPermanente } from "../erros.js";
import { log } from "../log.js";
import { concluir, jaProcessado, mandarParaDlq, marcarProcessado, reagendar, reivindicar } from "./fila.js";

// O worker: um laço que pede eventos para a fila e entrega cada um ao
// consumidor certo.

/**
 * @typedef {object} Consumidor
 * @property {string} nome usado na idempotência: (eventId, nome) só roda uma vez
 * @property {string[]} tipos tipos de evento que este consumidor atende
 * @property {number} concorrencia 1 = serializado (indexação), >1 = paralelo (mensagens)
 * @property {number} travaMs quanto tempo um evento fica reservado (deve cobrir o pior caso)
 * @property {(ev: import("../tipos.js").Evento) => Promise<void>} processar
 * @property {(ev: import("../tipos.js").Evento, erro: Error) => Promise<void>} [aoFalharDefinitivo]
 *   chamado quando o evento vai para a DLQ, para deixar o estado visível (ex.: repo com status "erro")
 */

/**
 * Sobe as "faixas" de cada consumidor e devolve um controle para desligar.
 * @param {Consumidor[]} consumidores
 */
export function iniciarWorker(consumidores) {
  let ativo = true;
  /** @type {Promise<void>[]} */
  const faixas = [];

  // Cada consumidor tem N faixas; cada faixa busca e processa um evento por vez.
  // Concorrência 4 = até 4 mensagens sendo respondidas ao mesmo tempo.
  for (const c of consumidores) {
    for (let i = 0; i < c.concorrencia; i++) {
      faixas.push(
        (async () => {
          while (ativo) {
            let ev = null;
            try {
              ev = await reivindicar(c.tipos, c.travaMs);
            } catch (e) {
              log("erro", "fila indisponível", { erro: String(e) });
            }
            if (!ev) {
              await dormir(500); // fila vazia: espera um pouco antes de perguntar de novo
              continue;
            }
            await executar(c, ev);
          }
        })(),
      );
    }
  }
  log("info", "worker iniciado", { consumidores: consumidores.map((c) => `${c.nome}x${c.concorrencia}`) });

  return {
    // Graceful shutdown: para de reivindicar e espera o que está rodando terminar.
    parar: async () => {
      ativo = false;
      await Promise.allSettled(faixas);
      log("info", "worker parado");
    },
  };
}

/**
 * @param {Consumidor} c
 * @param {import("../tipos.js").Evento} ev
 */
async function executar(c, ev) {
  const base = { evento: ev.tipo, eventId: ev._id, correlationId: ev.correlationId, tentativa: ev.tentativas };
  try {
    if (await jaProcessado(ev._id, c.nome)) {
      await concluir(ev._id);
      return;
    }
    await c.processar(ev);
    await marcarProcessado(ev, c.nome);
    await concluir(ev._id);
    log("info", "evento processado", base);
  } catch (e) {
    const erro = e instanceof Error ? e : new Error(String(e));
    if (erro instanceof ErroPermanente) {
      await mandarParaDlq(ev, erro.message);
      log("aviso", "evento na DLQ (erro permanente)", { ...base, erro: erro.message });
      await c.aoFalharDefinitivo?.(ev, erro).catch(() => {});
      return;
    }
    const destino = await reagendar(ev, erro.message);
    const msg = destino === "dlq" ? "evento na DLQ (tentativas esgotadas)" : "evento reagendado";
    log(destino === "dlq" ? "erro" : "aviso", msg, { ...base, erro: erro.message });
    if (destino === "dlq") await c.aoFalharDefinitivo?.(ev, erro).catch(() => {});
  }
}

/** @param {number} ms */
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
