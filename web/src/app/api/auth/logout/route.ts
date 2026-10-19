import { cookies } from "next/headers";
import { rota, json } from "@/lib/http";
import { COOKIE_REFRESH, limparCookies } from "@/lib/auth/sessao";
import { revogarRefresh } from "@/lib/auth/tokens";

export const POST = rota(async () => {
  const t = (await cookies()).get(COOKIE_REFRESH)?.value;
  if (t) await revogarRefresh(t);
  await limparCookies();
  return json({ ok: true });
});
