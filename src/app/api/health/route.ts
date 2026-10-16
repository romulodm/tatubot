import { rota, json } from "@/lib/http";
import { db } from "@/lib/db";
import { git } from "@/lib/indexacao/git";

export const dynamic = "force-dynamic";

export const GET = rota(async () => {
  const r: Record<string, string> = {};
  try {
    const d = await db();
    await d.command({ ping: 1 });
    const pendentes = await d.collection("eventos").countDocuments({ status: { $in: ["pendente", "processando"] } });
    const dlq = await d.collection("eventos").countDocuments({ status: "dlq" });
    r.banco = "ok";
    r.fila = `ok (${pendentes} na fila, ${dlq} na DLQ)`;
  } catch (e) {
    r.banco = `erro: ${(e as Error).message}`;
  }
  try {
    r.git = (await git(["--version"])).trim();
  } catch {
    r.git = "ausente";
  }
  const ok = r.banco === "ok" && r.git !== "ausente";
  return json({ ok, ...r }, ok ? 200 : 503);
});
