// Executado uma vez quando o servidor Next sobe. Com WORKER_MODE=inline o
// worker da fila roda no mesmo processo; com "off", rode `npm run worker`.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if ((process.env.WORKER_MODE ?? "inline") !== "inline") return;
  const { iniciarComDesligamento } = await import("./lib/fila/iniciar");
  iniciarComDesligamento();
}
