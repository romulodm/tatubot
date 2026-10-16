import { rota, json } from "@/lib/http";
import { db } from "@/lib/db";
import { ErroApp } from "@/lib/erros";
import { publicar } from "@/lib/fila/fila";
import { assinaturaValida } from "@/lib/webhook";
import type { Repositorio } from "@/lib/tipos";

// Rota pública: a autenticação é a assinatura HMAC do corpo com o segredo do repo.
export const POST = rota<{ repoId: string }>(async (req, { params, correlationId }) => {
  const corpo = await req.text();
  const assinatura = req.headers.get("x-hub-signature-256") ?? "";
  const repo = await (await db()).collection<Repositorio>("repositorios").findOne({ _id: params.repoId });
  // Mesmo erro para repo inexistente e assinatura inválida.
  if (!repo || !assinaturaValida(corpo, assinatura, repo.webhookSecret)) {
    throw new ErroApp(401, "ASSINATURA_INVALIDA", "Assinatura do webhook inválida");
  }
  const evento = req.headers.get("x-github-event");
  if (evento === "ping") return json({ ok: true });
  if (evento !== "push") return json({ ignorado: evento }, 202);

  let ref = "";
  let commitAlvo: string | undefined;
  try {
    const j = JSON.parse(corpo) as { ref?: string; after?: string };
    ref = j.ref ?? "";
    commitAlvo = j.after;
  } catch {
    throw new ErroApp(400, "JSON_INVALIDO", "Corpo do webhook inválido");
  }
  if (ref !== `refs/heads/${repo.branch}`) return json({ ignorado: `push em ${ref}` }, 202);

  // GitHub entrega webhooks "pelo menos uma vez": usar o delivery id como
  // eventId torna a reentrega idempotente.
  const delivery = req.headers.get("x-github-delivery") ?? undefined;
  try {
    await publicar("repo.sincronizar", { repoId: repo._id, origem: "webhook", commitAlvo }, { correlationId, eventId: delivery, produtor: "github" });
  } catch (e) {
    if ((e as { code?: number }).code !== 11000) throw e;
  }
  return json({ ok: true }, 202);
});
