import { config } from "./config.js";
import { criarApp } from "./app.js";
import { fechar } from "./db.js";
import { log } from "./log.js";
import { carregarJwks } from "./http/jwks.js";
import { iniciarWorker } from "./fila/worker.js";
import { consumidores } from "./fila/consumidores.js";

// Ponto de entrada da API HTTP.
//   npm start       -> só a API (o docker compose sobe o worker separado)
//   npm run dev     -> API + worker no mesmo processo (WORKER_MODE=inline)

const servidor = criarApp();
const worker = config.workerMode === "inline" ? iniciarWorker(consumidores) : null;

servidor.listen(config.porta, () => {
  log("info", "api no ar", { porta: config.porta, worker: config.workerMode, llm: config.llm.provider });
});

// Tenta carregar as chaves do web já na subida. Se o web ainda não estiver
// no ar, tudo bem: a primeira requisição autenticada tenta de novo.
carregarJwks().catch((e) => log("aviso", "JWKS ainda indisponível; tentarei de novo na primeira requisição", { erro: String(e.message ?? e) }));

// Graceful shutdown: no SIGTERM (docker stop), para de aceitar conexões,
// espera o worker terminar o que está fazendo e fecha o banco.
let desligando = false;
for (const sinal of /** @type {const} */ (["SIGTERM", "SIGINT"])) {
  process.once(sinal, async () => {
    if (desligando) return;
    desligando = true;
    log("info", "desligando", { sinal });
    // Conexões SSE ficam abertas por minutos; não esperamos por elas.
    servidor.closeAllConnections?.();
    servidor.close();
    await worker?.parar();
    await fechar();
    process.exit(0);
  });
}
