import { agora, db } from "../db.js";
import { falhar, responder } from "../agente/executar.js";
import { indexar, limparRepo } from "../indexacao/indexar.js";

// Quem consome o quê. Equivalente às filas do context.md:
//
//   indexador.repos     <- repo.*            concorrência 1: duas sincronizações
//                                            do mesmo repo nunca rodam juntas
//   indexador.mensagens <- mensagem.recebida concorrência 4: várias conversas
//                                            respondidas em paralelo

/** @type {import("./worker.js").Consumidor[]} */
export const consumidores = [
  {
    nome: "indexador.repos",
    tipos: ["repo.cadastrado", "repo.sincronizar", "repo.atualizado_config", "repo.removido"],
    concorrencia: 1,
    travaMs: 15 * 60_000, // clonar e embedar um repo grande demora
    async processar(ev) {
      const { repoId } = ev.payload;
      if (ev.tipo === "repo.removido") return limparRepo(repoId);
      if (ev.tipo === "repo.atualizado_config") await limparRepo(repoId); // branch mudou: começa do zero
      await indexar(repoId, ev.correlationId);
    },
    async aoFalharDefinitivo(ev, erro) {
      const { repoId } = ev.payload;
      const repos = (await db()).collection("repositorios");
      await repos.updateOne({ _id: repoId }, { $set: { status: "erro", erro: erro.message.slice(0, 300), progresso: null, atualizadoEm: agora() } });
    },
  },
  {
    nome: "indexador.mensagens",
    tipos: ["mensagem.recebida"],
    concorrencia: 4,
    travaMs: 5 * 60_000,
    processar: (ev) => responder(/** @type {any} */ (ev.payload), ev.correlationId),
    aoFalharDefinitivo: (ev, erro) => falhar(/** @type {any} */ (ev.payload), erro),
  },
];
