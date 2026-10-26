import { log } from "./config.js";
import { fechar } from "./db.js";
import { iniciarWorker } from "./fila.js";

// Mesmo código da api, outro processo: indexação pesada não deixa a api lenta
// e dá para escalar com `docker compose up --scale worker=3`.
const worker = iniciarWorker();

let desligando = false;
for (const sinal of ["SIGTERM", "SIGINT"]) {
  process.once(sinal, async () => {
    if (desligando) return;
    desligando = true;
    log("info", "desligando worker", { sinal });
    await worker.parar();
    await fechar();
    process.exit(0);
  });
}
