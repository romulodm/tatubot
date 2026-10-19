import Link from "next/link";

// Logotipo: o colchete de citação é a marca, porque citar é o que o produto faz.
export function Marca({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="marca" aria-label="tatubot, página inicial">
      <span className="marca-colchete">[</span>tatubot<span className="marca-colchete">]</span>
    </Link>
  );
}
