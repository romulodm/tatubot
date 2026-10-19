import { randomUUID } from "node:crypto";
import { rota, json, lerJson } from "@/lib/http";
import { db, agora } from "@/lib/db";
import { ErroApp } from "@/lib/erros";
import { texto, REGEX_EMAIL } from "@/lib/validar";
import { hashSenha } from "@/lib/auth/senha";
import { abrirSessao } from "@/lib/auth/sessao";
import { limitar } from "@/lib/limite";
import type { Usuario } from "@/lib/tipos";

export const POST = rota(async (req) => {
  limitar(`registrar:${req.headers.get("x-forwarded-for") ?? "local"}`, 10, 60 * 60_000);
  const c = await lerJson(req);
  const nome = texto(c, "nome", { nome: "Nome", obrigatorio: true, min: 2, max: 80 })!;
  const email = texto(c, "email", { nome: "E-mail", obrigatorio: true, max: 200, regex: REGEX_EMAIL })!.toLowerCase();
  const senha = texto(c, "senha", { nome: "Senha", obrigatorio: true, min: 8, max: 200 })!;

  const col = (await db()).collection<Usuario>("usuarios");
  // O primeiro usuário vira admin (conveniência para o ambiente de nivelamento).
  const primeiro = (await col.estimatedDocumentCount()) === 0;
  const u: Usuario = { _id: randomUUID(), nome, email, senhaHash: await hashSenha(senha), papel: primeiro ? "admin" : "usuario", criadoEm: agora(), atualizadoEm: agora() };
  try {
    await col.insertOne(u);
  } catch (e) {
    if ((e as { code?: number }).code === 11000) throw new ErroApp(409, "EMAIL_EM_USO", "Já existe uma conta com este e-mail");
    throw e;
  }
  await abrirSessao(u);
  return json({ usuario: { id: u._id, nome: u.nome, email: u.email, papel: u.papel } }, 201);
});
