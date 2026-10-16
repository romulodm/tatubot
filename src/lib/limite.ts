import { ErroApp } from "./erros";

// Rate limit em memória, janela deslizante. Suficiente para um processo;
// com várias instâncias, mover para o Mongo/Redis.
const g = globalThis as unknown as { _limites?: Map<string, number[]> };
const baldes: Map<string, number[]> = (g._limites ??= new Map());

export function limitar(chave: string, max: number, janelaMs: number) {
  const agora = Date.now();
  const hits = (baldes.get(chave) ?? []).filter((t) => agora - t < janelaMs);
  if (hits.length >= max) {
    const espera = Math.ceil((janelaMs - (agora - hits[0])) / 1000);
    throw new ErroApp(429, "LIMITE_EXCEDIDO", `Muitas tentativas. Tente de novo em ${espera}s`, { esperaSegundos: espera });
  }
  hits.push(agora);
  baldes.set(chave, hits);
}
