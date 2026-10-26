import { config, log } from "./config.js";
import { criarApp } from "./app.js";
import { carregarJwks } from "./auth.js";
import { fechar } from "./db.js";
import { iniciarWorker } from "./fila.js";

const servidor = criarApp();
const worker = config.workerMode === "inline" ? iniciarWorker() : null;

servidor.listen(config.porta, () => {
  log("info", "api no ar", { porta: config.porta, worker: config.workerMode, llm: config.llm.provider });
});

// se o web ainda não subiu, a primeira requisição autenticada tenta de novo
carregarJwks().catch((e) => log("aviso", "JWKS ainda indisponível", { erro: String(e.message ?? e) }));

let desligando = false;
for (const sinal of ["SIGTERM", "SIGINT"]) {
  process.once(sinal, async () => {
    if (desligando) return;
    desligando = true;
    log("info", "desligando", { sinal });
    servidor.closeAllConnections();
    servidor.close();
    await worker?.parar();
    await fechar();
    process.exit(0);
  });
}
