import { iniciarWorker } from "./worker";
import { consumidores } from "./consumidores";

// Sobe o worker e registra o graceful shutdown: no SIGTERM para de
// reivindicar eventos, espera os que estão rodando e só então sai.
export function iniciarComDesligamento() {
  const w = iniciarWorker(consumidores);
  for (const sinal of ["SIGTERM", "SIGINT"] as const) {
    process.once(sinal, () => {
      void w.parar().finally(() => process.exit(0));
    });
  }
  return w;
}
