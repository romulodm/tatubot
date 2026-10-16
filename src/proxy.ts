import { NextResponse, type NextRequest } from "next/server";

// Só repassa o caminho atual para o layout do app, que usa isso para voltar
// à mesma página depois de renovar a sessão. A autorização fica nas rotas.
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set("x-caminho", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: "/app/:path*" };
