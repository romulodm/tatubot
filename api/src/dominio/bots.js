import { SEEDICON_STYLES } from "seedicon";
import { db } from "../db.js";
import { invalido } from "../erros.js";
import { texto, listaIds } from "../http/validar.js";

// Validação compartilhada entre criar (POST) e editar (PATCH) bot.
// Ao criar, nome é obrigatório; ao editar, só vem o que mudou.

/**
 * @param {import("../tipos.js").Usuario} u
 * @param {Record<string, unknown>} c corpo da requisição
 * @param {boolean} criando
 */
export async function lerBot(u, c, criando) {
  const nome = texto(c, "nome", { nome: "Nome", obrigatorio: criando, min: 2, max: 40 });
  const instrucoes = texto(c, "instrucoes", { nome: "Instruções", max: 4000 });
  const modo = /** @type {import("../tipos.js").ModoBot | undefined} */ (texto(c, "modo", { nome: "Modo", valores: ["pipeline", "agente"] }));
  const avatarSeed = texto(c, "avatarSeed", { nome: "Avatar", max: 80 });
  // A lista de estilos vem do próprio seedicon: estilo novo na lib, aceito aqui sem mexer.
  const avatarEstilo = texto(c, "avatarEstilo", { nome: "Estilo do avatar", valores: SEEDICON_STYLES });
  const repoIds = listaIds(c, "repoIds", "Repositórios");
  if (repoIds?.length) await conferirRepos(u, repoIds);
  // instrucoes "" é diferente de ausente: é a pessoa apagando as instruções.
  return { nome, instrucoes: c.instrucoes === "" ? "" : instrucoes, modo, avatarSeed, avatarEstilo, repoIds };
}

/**
 * Um bot só pode ler repositórios do mesmo dono. Sem isso, bastaria mandar o
 * id do repositório de outra pessoa para o bot responder sobre ele.
 * @param {import("../tipos.js").Usuario} u
 * @param {string[]} repoIds
 */
export async function conferirRepos(u, repoIds) {
  const n = await (await db()).collection("repositorios").countDocuments({ _id: { $in: repoIds }, ownerId: u.sub });
  if (n !== repoIds.length) throw invalido("Algum repositório não existe ou não é seu", { campo: "repoIds" });
}
