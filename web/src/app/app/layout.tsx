import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { usuarioAtual } from "@/lib/auth";
import { Espaco } from "./Espaco";

export default async function LayoutApp({ children }: { children: React.ReactNode }) {
  const u = await usuarioAtual();
  if (!u) {
    const h = await headers();
    const caminho = h.get("x-caminho") ?? "/app";
    redirect(`/api/auth/refresh?volta=${encodeURIComponent(caminho)}`);
  }
  return <Espaco usuario={{ id: u.sub, nome: u.nome, papel: u.papel }}>{children}</Espaco>;
}
