import { randomUUID } from "node:crypto";

export class ErroApp extends Error {
  constructor(
    public status: number,
    public codigo: string,
    mensagem: string,
    public detalhes: Record<string, unknown> = {},
  ) {
    super(mensagem);
  }
}

export const naoAutorizado = () => new ErroApp(401, "NAO_AUTENTICADO", "Faça login para continuar");
const invalido = (mensagem: string, detalhes: Record<string, unknown> = {}) => new ErroApp(400, "VALIDACAO", mensagem, detalhes);

export function log(nivel: "info" | "aviso" | "erro", msg: string, campos: Record<string, unknown> = {}) {
  const linha = JSON.stringify({ nivel, msg, servico: "tatubot-web", em: new Date().toISOString(), ...campos });
  if (nivel === "erro") console.error(linha);
  else console.log(linha);
}

type Handler<P> = (req: Request, ctx: { params: P; correlationId: string }) => Promise<Response>;

// Envolve um route handler: correlation id, checagem de origem, erro no formato padrão e log.
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
    log("info", "http", { correlationId, metodo: req.method, url: new URL(req.url).pathname, status: res.status, ms: Date.now() - inicio });
    return res;
  };
}

function verificarOrigem(req: Request) {
  const origem = req.headers.get("origin");
  if (!origem) return;
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

export function json(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

export async function lerJson(req: Request): Promise<Record<string, unknown>> {
  const texto = await req.text();
  if (texto.length > 64 * 1024) throw new ErroApp(413, "CORPO_GRANDE", "Corpo da requisição grande demais");
  if (!texto) return {};
  let v: unknown;
  try {
    v = JSON.parse(texto);
  } catch {
    v = null;
  }
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    throw new ErroApp(400, "JSON_INVALIDO", "Corpo deve ser um objeto JSON");
  }
  return v as Record<string, unknown>;
}

type Regra = { nome: string; obrigatorio?: boolean; min?: number; max?: number; regex?: RegExp };

export function texto(corpo: Record<string, unknown>, campo: string, r: Regra & { obrigatorio: true }): string;
export function texto(corpo: Record<string, unknown>, campo: string, r: Regra): string | undefined;
export function texto(corpo: Record<string, unknown>, campo: string, r: Regra): string | undefined {
  const v = corpo[campo];
  if (v === undefined || v === null || v === "") {
    if (r.obrigatorio) throw invalido(`${r.nome} é obrigatório`, { campo });
    return undefined;
  }
  if (typeof v !== "string") throw invalido(`${r.nome} deve ser texto`, { campo });
  const s = v.trim();
  if (r.min !== undefined && s.length < r.min) throw invalido(`${r.nome} precisa de pelo menos ${r.min} caracteres`, { campo });
  if (r.max !== undefined && s.length > r.max) throw invalido(`${r.nome} aceita no máximo ${r.max} caracteres`, { campo });
  if (r.regex && !r.regex.test(s)) throw invalido(`${r.nome} em formato inválido`, { campo });
  return s;
}

export const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// rate limit em memória, por processo
const gl = globalThis as unknown as { _limites?: Map<string, number[]> };
const baldes: Map<string, number[]> = (gl._limites ??= new Map());

export function limitar(chave: string, max: number, janelaMs: number) {
  const agora = Date.now();
  const hits = (baldes.get(chave) ?? []).filter((t) => agora - t < janelaMs);
  if (hits.length >= max) {
    const espera = Math.ceil((janelaMs - (agora - hits[0])) / 1000);
    throw new ErroApp(429, "LIMITE_EXCEDIDO", `Muitas tentativas. Tente de novo em ${espera}s`, { esperaSegundos: espera });
  }
  hits.push(agora);
  baldes.set(chave, hits);
}
