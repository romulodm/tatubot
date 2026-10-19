import { fechar } from "./db.js";
import { log } from "./log.js";
import { iniciarWorker } from "./fila/worker.js";
import { consumidores } from "./fila/consumidores.js";

// Ponto de entrada do worker em processo separado (npm run worker).
// Mesmo código e mesma imagem Docker da API, outro comando.
//
// Separar ajuda de dois jeitos: uma indexação pesada não deixa a API lenta,
// e dá para escalar os dois de forma independente (ex.: 1 API e 3 workers;
// a fila no Mongo garante que cada evento vai para um worker só).

const worker = iniciarWorker(consumidores);

let desligando = false;
for (const sinal of /** @type {const} */ (["SIGTERM", "SIGINT"])) {
  process.once(sinal, async () => {
    if (desligando) return;
    desligando = true;
    log("info", "desligando worker", { sinal });
    await worker.parar();
    await fechar();
    process.exit(0);
  });
}
