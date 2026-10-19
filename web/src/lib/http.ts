import { randomUUID } from "node:crypto";
import { ErroApp } from "./erros";
import { log } from "./log";

export interface Ctx<P> {
  params: P;
  correlationId: string;
}

type Handler<P> = (req: Request, ctx: Ctx<P>) => Promise<Response>;

// Envolve um route handler: correlation id, checagem de origem em mutações
// (defesa extra contra CSRF além do SameSite=Lax) e formato de erro padronizado.
export function rota<P = Record<string, string>>(h: Handler<P>) {
  return async (req: Request, segs: { params: Promise<P> }): Promise<Response> => {
    const correlationId = req.headers.get("x-correlation-id") || randomUUID();
    const inicio = Date.now();
    let res: Response;
    try {
      if (!["GET", "HEAD"].includes(req.method)) verificarOrigem(req);
      const params = (await segs?.params) ?? ({} as P);
      res = await h(req, { params, correlationId });
    } catch (e) {
      res = respostaErro(e, correlationId);
    }
    res.headers.set("x-correlation-id", correlationId);
    if (!res.headers.get("content-type")?.includes("event-stream")) {
      log("info", "http", { correlationId, metodo: req.method, url: new URL(req.url).pathname, status: res.status, ms: Date.now() - inicio });
    }
    return res;
  };
}

function verificarOrigem(req: Request) {
  const origem = req.headers.get("origin");
  if (!origem) return; // curl, webhooks
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  if (host && new URL(origem).host !== host) {
    throw new ErroApp(403, "ORIGEM_INVALIDA", "Origem da requisição não permitida");
  }
}

export function respostaErro(e: unknown, correlationId: string): Response {
  if (e instanceof ErroApp) {
    return json({ erro: { codigo: e.codigo, mensagem: e.message, detalhes: e.detalhes } }, e.status);
  }
  log("erro", "erro não tratado", { correlationId, erro: e instanceof Error ? e.stack : String(e) });
  return json({ erro: { codigo: "ERRO_INTERNO", mensagem: "Erro interno", detalhes: {} } }, 500);
}

export function json(corpo: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

export async function lerJson(req: Request): Promise<Record<string, unknown>> {
  const texto = await req.text();
  if (texto.length > 64 * 1024) throw new ErroApp(413, "CORPO_GRANDE", "Corpo da requisição grande demais");
  if (!texto) return {};
  try {
    const v = JSON.parse(texto);
    if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error();
    return v;
  } catch {
    throw new ErroApp(400, "JSON_INVALIDO", "Corpo deve ser um objeto JSON");
  }
}
