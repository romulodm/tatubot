"use client";

// fetch com cookies de sessão. Em 401, tenta renovar o access token uma vez
// (rotação do refresh) e repete a chamada; se não der, manda para o login.
export class ErroApi extends Error {
  constructor(public status: number, public codigo: string, mensagem: string) {
    super(mensagem);
  }
}

let renovando: Promise<boolean> | null = null;

async function renovar(): Promise<boolean> {
  renovando ??= fetch("/api/auth/refresh", { method: "POST" })
    .then((r) => r.ok)
    .finally(() => setTimeout(() => (renovando = null), 0));
  return renovando;
}

export async function api<T = unknown>(caminho: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...resto } = init;
  const opcoes: RequestInit = {
    ...resto,
    headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...resto.headers },
    body: json !== undefined ? JSON.stringify(json) : resto.body,
  };
  let r = await fetch(caminho, opcoes);
  if (r.status === 401 && !caminho.startsWith("/api/auth/")) {
    if (await renovar()) r = await fetch(caminho, opcoes);
    else {
      window.location.href = `/entrar?volta=${encodeURIComponent(location.pathname)}`;
      throw new ErroApi(401, "NAO_AUTENTICADO", "Sessão expirada");
    }
  }
  if (r.status === 204) return undefined as T;
  const corpo = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = (corpo as { erro?: { codigo: string; mensagem: string } }).erro;
    throw new ErroApi(r.status, e?.codigo ?? "ERRO", e?.mensagem ?? `Erro ${r.status}`);
  }
  return corpo as T;
}

// Leitor de SSE sobre fetch (EventSource não manda cookies cross-origin nem
// permite headers; aqui é same-origin, mas o fetch dá controle de reconexão).
export async function ouvirEventos(caminho: string, aoEvento: (tipo: string, dado: unknown) => void, sinal: AbortSignal) {
  while (!sinal.aborted) {
    try {
      let r = await fetch(caminho, { signal: sinal, headers: { accept: "text/event-stream" } });
      if (r.status === 401 && (await renovar())) r = await fetch(caminho, { signal: sinal });
      if (!r.ok || !r.body) throw new Error(`SSE ${r.status}`);
      aoEvento("conectado", null);
      const leitor = r.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      for (;;) {
        const { value, done } = await leitor.read();
        if (done) break;
        buf += value;
        let i: number;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const bloco = buf.slice(0, i);
          buf = buf.slice(i + 2);
          let tipo = "message";
          let dado = "";
          for (const l of bloco.split("\n")) {
            if (l.startsWith("event:")) tipo = l.slice(6).trim();
            else if (l.startsWith("data:")) dado += l.slice(5).trim();
          }
          if (dado) aoEvento(tipo, JSON.parse(dado));
        }
      }
    } catch (e) {
      if (sinal.aborted) return;
    }
    // Reconexão: o cliente recarrega o histórico para não perder eventos.
    aoEvento("reconectando", null);
    await new Promise((r) => setTimeout(r, 1500));
  }
}
