import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { config, log } from "./config.js";
import { db } from "./db.js";
import { ErroApp } from "./erros.js";
import { Roteador, enviar, json, respostaDeErro } from "./http.js";
import { git } from "./indexacao/git.js";
import { rotasBots } from "./rotas/bots.js";
import { rotasConversas } from "./rotas/conversas.js";
import { rotasRepos } from "./rotas/repos.js";

export function criarApp() {
  const roteador = new Roteador();
  roteador.get("/api/health", saude);
  rotasRepos(roteador);
  rotasBots(roteador);
  rotasConversas(roteador);

  return createServer(async (req, res) => {
    const inicio = Date.now();
    const recebido = req.headers["x-correlation-id"];
    const correlationId = typeof recebido === "string" && /^[\w-]{1,64}$/.test(recebido) ? recebido : randomUUID();
    res.setHeader("x-correlation-id", correlationId);

    const url = new URL(req.url ?? "/", "http://localhost");
    const metodo = req.method ?? "GET";
    let resposta;
    try {
      if (!["GET", "HEAD", "OPTIONS"].includes(metodo)) verificarOrigem(req);

      let rota = null;
      try {
        rota = roteador.encontrar(metodo, url.pathname);
      } catch {
        // %-encoding inválido no caminho: trata como 404
      }
      if (!rota) throw new ErroApp(404, "ROTA_NAO_ENCONTRADA", "Rota não encontrada");
      if (rota.metodosPermitidos) {
        res.setHeader("allow", rota.metodosPermitidos.join(", "));
        throw new ErroApp(405, "METODO_NAO_PERMITIDO", "Método não permitido nesta rota");
      }
      resposta = await rota.handler({ req, res, url, params: rota.params, correlationId });
    } catch (e) {
      resposta = respostaDeErro(e, correlationId);
    }

    // null = o handler já escreveu a resposta (SSE)
    if (resposta) enviar(res, resposta);
    else if (!res.writableEnded) res.end();

    if (!url.pathname.endsWith("/eventos") && url.pathname !== "/api/health") {
      log("info", "http", { correlationId, metodo, url: url.pathname, status: res.statusCode, ms: Date.now() - inicio });
    }
  });
}

// CSRF: se o navegador mandou Origin, tem que ser o próprio site. Atrás do
// rewrite do Next, o host original vem em x-forwarded-host.
function verificarOrigem(req) {
  const origem = req.headers.origin;
  if (!origem || config.origensPermitidas.includes(origem.replace(/\/$/, ""))) return;
  const host = req.headers["x-forwarded-host"];
  try {
    if (typeof host === "string" && new URL(origem).host === host.split(",")[0].trim()) return;
  } catch {
    // Origin malformado
  }
  throw new ErroApp(403, "ORIGEM_INVALIDA", "Origem da requisição não permitida");
}

async function saude() {
  const s = {};
  try {
    const d = await db();
    await d.command({ ping: 1 });
    const eventos = d.collection("eventos");
    const pendentes = await eventos.countDocuments({ status: { $in: ["pendente", "processando"] } });
    const dlq = await eventos.countDocuments({ status: "dlq" });
    s.banco = "ok";
    s.fila = `ok (${pendentes} na fila, ${dlq} na DLQ)`;
  } catch (e) {
    s.banco = `erro: ${e.message}`;
  }
  try {
    s.git = (await git(["--version"])).trim();
  } catch {
    s.git = "ausente";
  }
  s.llm =
    config.llm.provider === "local"
      ? "local (sem LLM, respostas extrativas)"
      : `${config.llm.chatModel} @ ${new URL(config.llm.baseUrl).host}`;
  const ok = s.banco === "ok" && s.git !== "ausente";
  return json({ ok, servico: "api", ...s }, ok ? 200 : 503);
}
