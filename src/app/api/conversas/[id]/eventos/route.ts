import { rota } from "@/lib/http";
import { db } from "@/lib/db";
import { exigirUsuario } from "@/lib/auth/sessao";
import { conversaDoUsuario } from "@/lib/recursos";
import { mensagemPublica } from "@/lib/mensagens";
import type { Mensagem } from "@/lib/tipos";

export const dynamic = "force-dynamic";

// SSE autenticado por cookie (sem JWT na URL). O servidor observa as
// mensagens da conversa e envia cada mudança. Polling curto no Mongo em vez
// de change streams, que exigem replica set.
export const GET = rota<{ id: string }>(async (req, { params }) => {
  const u = await exigirUsuario();
  const c = await conversaDoUsuario(u, params.id);
  const col = (await db()).collection<Mensagem>("mensagens");
  const enc = new TextEncoder();
  let fechado = false;

  const corpo = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      const enviar = (evento: string, dado: unknown) => {
        if (!fechado) ctrl.enqueue(enc.encode(`event: ${evento}\ndata: ${JSON.stringify(dado)}\n\n`));
      };
      req.signal.addEventListener("abort", () => (fechado = true));
      const limite = Date.now() + 5 * 60_000; // o cliente reconecta
      let marca = new Date(0);
      let ultimoPing = Date.now();
      // Na conexão: estado atual das respostas ainda em andamento.
      const abertas = await col.find({ conversaId: c._id, status: { $in: ["pendente", "processando"] } }).toArray();
      for (const m of abertas) enviar("mensagem", mensagemPublica(m));
      marca = new Date();

      while (!fechado && Date.now() < limite) {
        await new Promise((r) => setTimeout(r, 350));
        const mudadas = await col.find({ conversaId: c._id, autor: "bot", atualizadoEm: { $gt: marca } }).sort({ atualizadoEm: 1 }).toArray();
        for (const m of mudadas) {
          enviar("mensagem", mensagemPublica(m));
          if (m.atualizadoEm > marca) marca = m.atualizadoEm;
        }
        if (Date.now() - ultimoPing > 15_000) {
          ultimoPing = Date.now();
          if (!fechado) ctrl.enqueue(enc.encode(`: ping\n\n`));
        }
      }
      if (!fechado) ctrl.close();
    },
    cancel() {
      fechado = true;
    },
  });

  return new Response(corpo, {
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" },
  });
});
