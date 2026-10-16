import { rota, json, lerJson } from "@/lib/http";
import { db } from "@/lib/db";
import { ErroApp } from "@/lib/erros";
import { texto } from "@/lib/validar";
import { conferirSenha, HASH_FALSO } from "@/lib/auth/senha";
import { abrirSessao } from "@/lib/auth/sessao";
import { limitar } from "@/lib/limite";
import type { Usuario } from "@/lib/tipos";

export const POST = rota(async (req) => {
  const c = await lerJson(req);
  const email = texto(c, "email", { nome: "E-mail", obrigatorio: true, max: 200 })!.toLowerCase();
  const senha = texto(c, "senha", { nome: "Senha", obrigatorio: true, max: 200 })!;
  limitar(`login:${req.headers.get("x-forwarded-for") ?? "local"}:${email}`, 5, 60_000);

  const u = await (await db()).collection<Usuario>("usuarios").findOne({ email });
  // Confere contra um hash falso quando o e-mail não existe: mesmo tempo de resposta.
  const ok = await conferirSenha(senha, u?.senhaHash ?? HASH_FALSO);
  if (!u || !ok) throw new ErroApp(401, "CREDENCIAIS_INVALIDAS", "E-mail ou senha incorretos");
  await abrirSessao(u);
  return json({ usuario: { id: u._id, nome: u.nome, email: u.email, papel: u.papel } });
});
