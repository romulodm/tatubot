import { db, type Usuario } from "@/lib/db";
import { ErroApp, json, lerJson, limitar, rota, texto } from "@/lib/http";
import { abrirSessao, conferirSenha, HASH_FALSO } from "@/lib/auth";

export const POST = rota(async (req) => {
  const c = await lerJson(req);
  const email = texto(c, "email", { nome: "E-mail", obrigatorio: true, max: 200 }).toLowerCase();
  const senha = texto(c, "senha", { nome: "Senha", obrigatorio: true, max: 200 });
  limitar(`login:${req.headers.get("x-forwarded-for") ?? "local"}:${email}`, 5, 60_000);

  const u = await (await db()).collection<Usuario>("usuarios").findOne({ email });
  const ok = await conferirSenha(senha, u?.senhaHash ?? HASH_FALSO);
  if (!u || !ok) throw new ErroApp(401, "CREDENCIAIS_INVALIDAS", "E-mail ou senha incorretos");
  await abrirSessao(u);
  return json({ usuario: { id: u._id, nome: u.nome, email: u.email, papel: u.papel } });
});
