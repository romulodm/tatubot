import { rota, json } from "@/lib/http";
import { exigirUsuario } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { naoAutorizado } from "@/lib/erros";
import type { Usuario } from "@/lib/tipos";

export const GET = rota(async () => {
  const c = await exigirUsuario();
  const u = await (await db()).collection<Usuario>("usuarios").findOne({ _id: c.sub }, { projection: { senhaHash: 0 } });
  if (!u) throw naoAutorizado();
  return json({ usuario: { id: u._id, nome: u.nome, email: u.email, papel: u.papel } });
});
