import { ErroPermanente } from "../erros";
import { log } from "../log";
import type { Evento } from "../tipos";
import { concluir, jaProcessado, mandarParaDlq, marcarProcessado, reagendar, reivindicar } from "./fila";

export interface Consumidor {
  nome: string;
  tipos: string[];
  concorrencia: number; // 1 = serializado (indexação), >1 = paralelo (mensagens)
  travaMs: number;
  processar: (ev: Evento) => Promise<void>;
  aoFalharDefinitivo?: (ev: Evento, erro: Error) => Promise<void>;
}

const g = globalThis as unknown as { _worker?: { parar: () => Promise<void> } };

export function iniciarWorker(consumidores: Consumidor[]) {
  if (g._worker) return g._worker;
  let ativo = true;
  const emAndamento = new Set<Promise<void>>();

  // Cada consumidor tem N "faixas"; cada faixa busca um evento por vez.
  for (const c of consumidores) {
    for (let i = 0; i < c.concorrencia; i++) {
      const faixa = (async () => {
        while (ativo) {
          let ev: Evento | null = null;
          try {
            ev = await reivindicar(c.tipos, c.travaMs);
          } catch (e) {
            log("erro", "fila indisponível", { erro: String(e) });
          }
          if (!ev) {
            await dormir(500);
            continue;
          }
          await executar(c, ev);
        }
      })();
      emAndamento.add(faixa);
    }
  }
  log("info", "worker iniciado", { consumidores: consumidores.map((c) => `${c.nome}x${c.concorrencia}`) });

  g._worker = {
    // Graceful shutdown: para de reivindicar e espera o que está rodando.
    parar: async () => {
      ativo = false;
      await Promise.allSettled(emAndamento);
      g._worker = undefined;
    },
  };
  return g._worker;
}

async function executar(c: Consumidor, ev: Evento) {
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
    log(destino === "dlq" ? "erro" : "aviso", destino === "dlq" ? "evento na DLQ (tentativas esgotadas)" : "evento reagendado", { ...base, erro: erro.message });
    if (destino === "dlq") await c.aoFalharDefinitivo?.(ev, erro).catch(() => {});
  }
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
