import { generateAvatar } from "seedicon";

export function Avatar({
  seed,
  estilo = "pixelart",
  tamanho = 32,
  forma = "circle",
}: {
  seed: string;
  estilo?: string;
  tamanho?: number;
  forma?: "circle" | "rounded" | "square";
}) {
  const svg = generateAvatar({ seed, style: estilo as never, size: tamanho, shape: forma });
  return (
    <span
      className="avatar"
      data-forma={forma}
      style={{ width: tamanho, height: tamanho }}
      aria-hidden
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
