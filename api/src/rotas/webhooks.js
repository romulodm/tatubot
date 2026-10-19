import { db } from "../db.js";
import { ErroApp } from "../erros.js";
import { lerTexto } from "../http/corpo.js";
import { json } from "../http/responder.js";
import { publicar } from "../fila/fila.js";
import { assinaturaValida } from "../dominio/webhook.js";

// Webhook do GitHub: a cada push na branch indexada, sincroniza o repositório.
//
// Rota PÚBLICA (o GitHub não tem cookie de ninguém). A autenticação é a
// assinatura HMAC do corpo com o segredo do repositório, que só o dono vê
// na tela de detalhes.

/** @param {import("../http/roteador.js").Roteador} r */
export function rotasWebhooks(r) {
  r.post("/api/webhooks/github/:repoId", async ({ req, params, correlationId }) => {
    // Corpo CRU: a assinatura é sobre os bytes exatos que o GitHub mandou.
    const corpo = await lerTexto(req, 1024 * 1024);
    const assinatura = String(req.headers["x-hub-signature-256"] ?? "");
    const repo = await (await db()).collection("repositorios").findOne({ _id: /** @type {any} */ (params.repoId) });
    // Mesmo erro para repo inexistente e assinatura inválida (não revelar quais ids existem).
    if (!repo || !assinaturaValida(corpo, assinatura, repo.webhookSecret)) {
      throw new ErroApp(401, "ASSINATURA_INVALIDA", "Assinatura do webhook inválida");
    }
    const evento = req.headers["x-github-event"];
    if (evento === "ping") return json({ ok: true });
    if (evento !== "push") return json({ ignorado: evento }, 202);

    let ref = "";
    let commitAlvo;
    try {
      const j = JSON.parse(corpo);
      ref = j.ref ?? "";
      commitAlvo = j.after;
    } catch {
      throw new ErroApp(400, "JSON_INVALIDO", "Corpo do webhook inválido");
    }
    if (ref !== `refs/heads/${repo.branch}`) return json({ ignorado: `push em ${ref}` }, 202);

    // O GitHub entrega webhooks "pelo menos uma vez". Usar o delivery id como
    // eventId torna a reentrega idempotente: o segundo insert bate no _id
    // duplicado (erro 11000) e simplesmente ignoramos.
    const delivery = req.headers["x-github-delivery"];
    try {
      await publicar(
        "repo.sincronizar",
        { repoId: repo._id, origem: "webhook", commitAlvo },
        { correlationId, eventId: typeof delivery === "string" ? delivery : undefined, produtor: "github" },
      );
    } catch (e) {
      if (/** @type {{ code?: number }} */ (e).code !== 11000) throw e;
    }
    return json({ ok: true }, 202);
  });
}
