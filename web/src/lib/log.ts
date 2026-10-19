// Logs JSON em uma linha. Nunca logar senha, token, .env ou prompt completo.
export function log(nivel: "info" | "aviso" | "erro", msg: string, campos: Record<string, unknown> = {}) {
  const linha = JSON.stringify({ nivel, msg, servico: "tatubot-web", em: new Date().toISOString(), ...campos });
  if (nivel === "erro") console.error(linha);
  else console.log(linha);
}
