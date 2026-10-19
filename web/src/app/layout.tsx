import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "tatubot — colegas de IA que leram o seu código",
  description: "Conecte um repositório do GitHub, crie bots com um trabalho cada e pergunte sobre o código. Toda resposta cita o arquivo e as linhas de onde saiu.",
};

export const viewport: Viewport = { themeColor: "#0a0a0a", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
