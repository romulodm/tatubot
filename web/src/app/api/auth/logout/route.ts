import { cookies } from "next/headers";
import { json, rota } from "@/lib/http";
import { COOKIE_REFRESH, limparCookies, revogarRefresh } from "@/lib/auth";

export const POST = rota(async () => {
  const t = (await cookies()).get(COOKIE_REFRESH)?.value;
  if (t) await revogarRefresh(t);
  await limparCookies();
  return json({ ok: true });
});
