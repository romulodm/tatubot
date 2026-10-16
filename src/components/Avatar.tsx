import { generateAvatar } from "seedicon";

// SVG determinístico a partir da seed do bot: nada para armazenar ou servir.
export function Avatar({ seed, estilo = "pixelart", tamanho = 32 }: { seed: string; estilo?: string; tamanho?: number }) {
  const svg = generateAvatar({ seed, style: estilo as never, size: tamanho, shape: "circle" });
  return <span className="avatar" style={{ width: tamanho, height: tamanho }} aria-hidden dangerouslySetInnerHTML={{ __html: svg }} />;
}
