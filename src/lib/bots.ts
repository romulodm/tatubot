import { db } from "./db";
import { invalido } from "./erros";
import { SEEDICON_STYLES } from "seedicon";
import { texto, listaIds } from "./validar";
import type { Claims } from "./auth/tokens";
import type { ModoBot, Repositorio } from "./tipos";

// Validação compartilhada entre criar e editar bot.
export async function lerBot(u: Claims, c: Record<string, unknown>, criando: boolean) {
  const nome = texto(c, "nome", { nome: "Nome", obrigatorio: criando, min: 2, max: 40 });
  const instrucoes = texto(c, "instrucoes", { nome: "Instruções", max: 4000 });
  const modo = texto(c, "modo", { nome: "Modo", valores: ["pipeline", "agente"] }) as ModoBot | undefined;
  const avatarSeed = texto(c, "avatarSeed", { nome: "Avatar", max: 80 });
  const avatarEstilo = texto(c, "avatarEstilo", { nome: "Estilo do avatar", valores: SEEDICON_STYLES as readonly string[] });
  const repoIds = listaIds(c, "repoIds", "Repositórios");
  if (repoIds?.length) await conferirRepos(u, repoIds);
  return { nome, instrucoes: c.instrucoes === "" ? "" : instrucoes, modo, avatarSeed, avatarEstilo, repoIds };
}

// Um bot só pode usar repositórios do mesmo dono.
export async function conferirRepos(u: Claims, repoIds: string[]) {
  const n = await (await db()).collection<Repositorio>("repositorios").countDocuments({ _id: { $in: repoIds }, ownerId: u.sub });
  if (n !== repoIds.length) throw invalido("Algum repositório não existe ou não é seu", { campo: "repoIds" });
}
