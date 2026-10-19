import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { ErroApp } from "./erros.js";
import { log } from "./log.js";
import { Roteador } from "./http/roteador.js";
import { enviar, respostaDeErro } from "./http/responder.js";
import { rotasBots } from "./rotas/bots.js";
import { rotasConversas } from "./rotas/conversas.js";
import { rotasRepos } from "./rotas/repos.js";
import { rotasSaude } from "./rotas/saude.js";
import { rotasWebhooks } from "./rotas/webhooks.js";

// Monta o servidor HTTP: um `node:http` puro com o nosso roteador.
//
// Separado do server.js para os testes poderem subir o app numa porta
// aleatória, sem worker e sem sinais de processo.
//
// O caminho de toda requisição:
//   correlation id ─► checagem de origem (mutações) ─► rota ─► handler
//        └──────────── qualquer erro vira { erro: {...} } ◄───────┘

export function criarRoteador() {
  const r = new Roteador();
  rotasSaude(r);
  rotasRepos(r);
  rotasBots(r);
  rotasConversas(r);
  rotasWebhooks(r);
  return r;
}

export function criarApp() {
  const roteador = criarRoteador();

  return createServer(async (req, res) => {
    const inicio = Date.now();
    // correlation id: vem do header (o web pode mandar) ou nasce aqui. Ele
    // segue para os eventos da fila e para os logs do worker, então dá para
    // seguir uma pergunta do clique até a resposta.
    const recebido = req.headers["x-correlation-id"];
    const correlationId = typeof recebido === "string" && /^[\w-]{1,64}$/.test(recebido) ? recebido : randomUUID();
    res.setHeader("x-correlation-id", correlationId);

    const url = new URL(req.url ?? "/", "http://localhost");
    let resposta;
    try {
      const metodo = req.method ?? "GET";
      if (!["GET", "HEAD", "OPTIONS"].includes(metodo)) verificarOrigem(req);

      let achado;
      try {
        achado = roteador.encontrar(metodo, url.pathname);
      } catch {
        achado = null; // %-encoding inválido no caminho
      }
      if (!achado) throw new ErroApp(404, "ROTA_NAO_ENCONTRADA", "Rota não encontrada");
      if ("metodosPermitidos" in achado) {
        res.setHeader("allow", achado.metodosPermitidos.join(", "));
        throw new ErroApp(405, "METODO_NAO_PERMITIDO", "Método não permitido nesta rota");
      }
      resposta = await achado.handler({ req, res, url, params: achado.params, correlationId });
    } catch (e) {
      resposta = respostaDeErro(e, correlationId);
    }

    // `null` = o handler já escreveu a resposta (SSE). Se ele falhou no meio
    // do stream, não dá mais para mandar status; só fechamos.
    if (resposta) enviar(res, resposta);
    else if (!res.writableEnded) res.end();

    if (!url.pathname.endsWith("/eventos") && url.pathname !== "/api/health") {
      log("info", "http", { correlationId, metodo: req.method, url: url.pathname, status: res.statusCode, ms: Date.now() - inicio });
    }
  });
}

/**
 * Defesa extra contra CSRF (além do cookie SameSite=Lax): se o navegador
 * mandou Origin, ela precisa ser o próprio site. Sem Origin (curl, o
 * webhook do GitHub, outro serviço) não há navegador para enganar.
 *
 * O navegador fala com o Next, que repassa /api/* para cá. Então comparamos
 * com a lista WEB_ORIGIN e também com o host original (x-forwarded-host).
 * @param {import("node:http").IncomingMessage} req
 */
function verificarOrigem(req) {
  const origem = req.headers.origin;
  if (!origem) return;
  if (config.origensPermitidas.includes(origem.replace(/\/$/, ""))) return;
  const host = req.headers["x-forwarded-host"];
  try {
    if (typeof host === "string" && new URL(origem).host === host.split(",")[0].trim()) return;
  } catch {
    // Origin malformado cai no erro abaixo
  }
  throw new ErroApp(403, "ORIGEM_INVALIDA", "Origem da requisição não permitida");
}
