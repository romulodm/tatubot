import { invalido } from "../erros.js";

// Validação escrita à mão: pequena, explícita e com mensagens em português.
// (O context.md pede o serviço sem lib de validação, e para meia dúzia de
// campos isso aqui dá conta.)

/**
 * @typedef {object} Regra
 * @property {string} nome nome do campo como aparece na mensagem de erro
 * @property {boolean} [obrigatorio]
 * @property {number} [min] tamanho mínimo (depois do trim)
 * @property {number} [max] tamanho máximo
 * @property {RegExp} [regex]
 * @property {readonly string[]} [valores] lista fechada de valores aceitos
 */

/**
 * Lê um campo de texto do corpo. Vazio/ausente vira `undefined`
 * (ou erro, se for obrigatório). Sempre devolve o valor com trim.
 * @param {Record<string, unknown>} corpo
 * @param {string} campo
 * @param {Regra} r
 * @returns {string | undefined}
 */
export function texto(corpo, campo, r) {
  const v = corpo[campo];
  if (v === undefined || v === null || v === "") {
    if (r.obrigatorio) throw invalido(`${r.nome} é obrigatório`, { campo });
    return undefined;
  }
  if (typeof v !== "string") throw invalido(`${r.nome} deve ser texto`, { campo });
  const s = v.trim();
  if (r.min !== undefined && s.length < r.min) throw invalido(`${r.nome} precisa de pelo menos ${r.min} caracteres`, { campo });
  if (r.max !== undefined && s.length > r.max) throw invalido(`${r.nome} aceita no máximo ${r.max} caracteres`, { campo });
  if (r.regex && !r.regex.test(s)) throw invalido(`${r.nome} em formato inválido`, { campo });
  if (r.valores && !r.valores.includes(s)) throw invalido(`${r.nome} deve ser um de: ${r.valores.join(", ")}`, { campo });
  return s;
}

/**
 * Lista de ids (até 20, sem repetidos).
 * @param {Record<string, unknown>} corpo
 * @param {string} campo
 * @param {string} nome
 * @returns {string[] | undefined}
 */
export function listaIds(corpo, campo, nome) {
  const v = corpo[campo];
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length > 20 || v.some((x) => typeof x !== "string" || x.length > 64)) {
    throw invalido(`${nome} deve ser uma lista de até 20 ids`, { campo });
  }
  return [...new Set(v)];
}

// Só repositórios públicos do GitHub. Os grupos capturam owner e nome.
// Repare que não há como encaixar espaço, ";" ou "&&" aqui: mesmo assim o git
// é chamado sem shell (ver indexacao/git.js), defesa em profundidade.
export const REGEX_REPO_URL = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(\.git)?\/?$/;
export const REGEX_BRANCH = /^[A-Za-z0-9._\/-]{1,100}$/;
