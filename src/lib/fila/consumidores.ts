import { agora, db } from "../db";
import { falhar, responder, type PayloadMensagem } from "../agente/executar";
import { indexar, limparRepo } from "../indexacao/indexar";
import type { Repositorio } from "../tipos";
import type { Consumidor } from "./worker";

// Topologia equivalente às filas do context.md:
//   indexador.repos     <- repo.*            (concorrência 1: sincronizações serializadas)
//   indexador.mensagens <- mensagem.recebida (concorrência 4)
export const consumidores: Consumidor[] = [
  {
    nome: "indexador.repos",
    tipos: ["repo.cadastrado", "repo.sincronizar", "repo.atualizado_config", "repo.removido"],
    concorrencia: 1,
    travaMs: 15 * 60_000,
    async processar(ev) {
      const { repoId } = ev.payload as { repoId: string };
      if (ev.tipo === "repo.removido") return limparRepo(repoId);
      if (ev.tipo === "repo.atualizado_config") await limparRepo(repoId); // branch mudou: começa do zero
      await indexar(repoId, ev.correlationId);
    },
    async aoFalharDefinitivo(ev, erro) {
      const { repoId } = ev.payload as { repoId: string };
      await (await db()).collection<Repositorio>("repositorios").updateOne(
        { _id: repoId },
        { $set: { status: "erro", erro: erro.message.slice(0, 300), progresso: null, atualizadoEm: agora() } },
      );
    },
  },
  {
    nome: "indexador.mensagens",
    tipos: ["mensagem.recebida"],
    concorrencia: 4,
    travaMs: 5 * 60_000,
    processar: (ev) => responder(ev.payload as unknown as PayloadMensagem, ev.correlationId),
    aoFalharDefinitivo: (ev, erro) => falhar(ev.payload as unknown as PayloadMensagem, erro),
  },
];
