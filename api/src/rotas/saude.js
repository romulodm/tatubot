import { db } from "../db.js";
import { json } from "../http/responder.js";
import { git } from "../indexacao/git.js";
import { config } from "../config.js";

// Health check: usado pelo docker compose para saber quando o serviço está
// pronto, e por quem estiver depurando ("a fila está andando?").

/** @param {import("../http/roteador.js").Roteador} r */
export function rotasSaude(r) {
  r.get("/api/health", async () => {
    /** @type {Record<string, string>} */
    const s = {};
    try {
      const d = await db();
      await d.command({ ping: 1 });
      const pendentes = await d.collection("eventos").countDocuments({ status: { $in: ["pendente", "processando"] } });
      const dlq = await d.collection("eventos").countDocuments({ status: "dlq" });
      s.banco = "ok";
      s.fila = `ok (${pendentes} na fila, ${dlq} na DLQ)`;
    } catch (e) {
      s.banco = `erro: ${/** @type {Error} */ (e).message}`;
    }
    try {
      s.git = (await git(["--version"])).trim();
    } catch {
      s.git = "ausente";
    }
    // Nunca expor a chave; só se existe e qual provedor/modelo está em uso.
    s.llm = config.llm.provider === "local" ? "local (sem LLM, respostas extrativas)" : `${config.llm.chatModel} @ ${new URL(config.llm.baseUrl).host}`;
    const ok = s.banco === "ok" && s.git !== "ausente";
    return json({ ok, servico: "api", ...s }, ok ? 200 : 503);
  });
}
