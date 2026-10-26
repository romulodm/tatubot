import { db, type Usuario } from "@/lib/db";
import { json, naoAutorizado, rota } from "@/lib/http";
import { exigirUsuario } from "@/lib/auth";

export const GET = rota(async () => {
  const c = await exigirUsuario();
  const u = await (await db()).collection<Usuario>("usuarios").findOne({ _id: c.sub }, { projection: { senhaHash: 0 } });
  if (!u) throw naoAutorizado();
  return json({ usuario: { id: u._id, nome: u.nome, email: u.email, papel: u.papel } });
});
