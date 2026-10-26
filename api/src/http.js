import { ErroApp, invalido } from "./erros.js";
import { log } from "./config.js";

// Roteador, leitura do corpo, respostas, validação e rate limit.
// Tudo à mão, sem framework HTTP.

export class Roteador {
  rotas = [];

  adicionar(metodo, padrao, handler) {
    const nomes = [];
    const fonte = padrao
      .split("/")
      .map((seg) => {
        if (!seg.startsWith(":")) return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        nomes.push(seg.slice(1));
        return "([^/]+)";
      })
      .join("/");
    this.rotas.push({ metodo, regex: new RegExp(`^${fonte}/?$`), nomes, handler });
    return this;
  }

  get(p, h) {
    return this.adicionar("GET", p, h);
  }
  post(p, h) {
    return this.adicionar("POST", p, h);
  }
  put(p, h) {
    return this.adicionar("PUT", p, h);
  }
  patch(p, h) {
    return this.adicionar("PATCH", p, h);
  }
  delete(p, h) {
    return this.adicionar("DELETE", p, h);
  }

  // { handler, params } | { metodosPermitidos } (405) | null (404)
  encontrar(metodo, caminho) {
    const metodosPermitidos = [];
    for (const r of this.rotas) {
      const m = r.regex.exec(caminho);
      if (!m) continue;
      if (r.metodo !== metodo && !(metodo === "HEAD" && r.metodo === "GET")) {
        metodosPermitidos.push(r.metodo);
        continue;
      }
      const params = {};
      r.nomes.forEach((nome, i) => (params[nome] = decodeURIComponent(m[i + 1])));
      return { handler: r.handler, params };
    }
    return metodosPermitidos.length ? { metodosPermitidos } : null;
  }
}

// ---------- corpo ----------

export function lerTexto(req, limite = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const pedacos = [];
    let total = 0;
    req.on("data", (p) => {
      total += p.length;
      if (total > limite) {
        reject(new ErroApp(413, "CORPO_GRANDE", "Corpo da requisição grande demais"));
        req.destroy();
        return;
      }
      pedacos.push(p);
    });
    req.on("end", () => resolve(Buffer.concat(pedacos).toString("utf8")));
    req.on("error", reject);
  });
}

export async function lerJson(req) {
  const texto = await lerTexto(req);
  if (!texto) return {};
  if (!(req.headers["content-type"] ?? "").includes("application/json")) {
    throw new ErroApp(415, "TIPO_NAO_SUPORTADO", "Envie o corpo como application/json");
  }
  let v;
  try {
    v = JSON.parse(texto);
  } catch {
    v = null;
  }
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    throw new ErroApp(400, "JSON_INVALIDO", "Corpo deve ser um objeto JSON");
  }
  return v;
}

// ---------- respostas ----------

export const json = (corpo, status = 200, headers = {}) => ({ status, corpo, headers });
export const semConteudo = () => ({ status: 204 });

export function respostaDeErro(e, correlationId) {
  if (e instanceof ErroApp) {
    return json({ erro: { codigo: e.codigo, mensagem: e.message, detalhes: e.detalhes } }, e.status);
  }
  log("erro", "erro não tratado", { correlationId, erro: e instanceof Error ? e.stack : String(e) });
  return json({ erro: { codigo: "ERRO_INTERNO", mensagem: "Erro interno", detalhes: {} } }, 500);
}

export function enviar(res, r) {
  if (res.headersSent) return;
  const headers = { ...r.headers };
  let corpo = "";
  if (r.corpo !== undefined) {
    corpo = JSON.stringify(r.corpo);
    headers["content-type"] = "application/json; charset=utf-8";
  }
  res.writeHead(r.status, headers);
  res.end(corpo);
}

export function abrirSse(res, correlationId) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    // no-transform: o proxy do Next não pode comprimir nem segurar o stream
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
    "x-correlation-id": correlationId,
  });
  res.flushHeaders();
  const escrever = (texto) => !res.writableEnded && res.write(texto);
  return {
    evento: (nome, dado) => escrever(`event: ${nome}\ndata: ${JSON.stringify(dado)}\n\n`),
    ping: () => escrever(": ping\n\n"),
    fechar: () => !res.writableEnded && res.end(),
  };
}

export function paginacao(url) {
  const pagina = Math.max(1, Number(url.searchParams.get("pagina")) || 1);
  const limite = Math.min(100, Math.max(1, Number(url.searchParams.get("limite")) || 20));
  return { pagina, limite, pular: (pagina - 1) * limite };
}

// ---------- validação ----------

export const REGEX_REPO_URL = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(\.git)?\/?$/;
export const REGEX_BRANCH = /^[A-Za-z0-9._/-]{1,100}$/;

// Campo de texto opcional (ou obrigatório) com trim. Vazio vira undefined.
export function texto(corpo, campo, r) {
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
  if (r.valores && !r.valores.includes(s)) throw invalido(`${r.nome} deve ser um de: ${r.valores.join(", ")}`, { campo });
  return s;
}

export function listaIds(corpo, campo, nome) {
  const v = corpo[campo];
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length > 20 || v.some((x) => typeof x !== "string" || x.length > 64)) {
    throw invalido(`${nome} deve ser uma lista de até 20 ids`, { campo });
  }
  return [...new Set(v)];
}

// ---------- rate limit ----------
// Em memória e por processo. Com várias réplicas da api, cada uma conta separado.

const baldes = new Map();

export function limitar(chave, max, janelaMs) {
  const agora = Date.now();
  const hits = (baldes.get(chave) ?? []).filter((t) => agora - t < janelaMs);
  if (hits.length >= max) {
    const espera = Math.ceil((janelaMs - (agora - hits[0])) / 1000);
    throw new ErroApp(429, "LIMITE_EXCEDIDO", `Muitas tentativas. Tente de novo em ${espera}s`, { esperaSegundos: espera });
  }
  hits.push(agora);
  baldes.set(chave, hits);
}

setInterval(() => {
  const agora = Date.now();
  for (const [k, hits] of baldes) if (!hits.some((t) => agora - t < 60 * 60_000)) baldes.delete(k);
}, 10 * 60_000).unref();
