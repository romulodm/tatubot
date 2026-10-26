import Link from "next/link";

export function Marca({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="marca" aria-label="tatubot, página inicial">
      <span className="marca-colchete">[</span>tatubot<span className="marca-colchete">]</span>
    </Link>
  );
}
