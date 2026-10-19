// Roteador escrito à mão (o context.md pede o serviço sem framework HTTP).
//
// A ideia é pequena: cada rota vira uma regex na hora do registro.
//   "/api/repos/:id/arquivos"  ->  /^\/api\/repos\/([^/]+)\/arquivos$/
// e os nomes dos parâmetros (["id"]) ficam guardados ao lado. Na hora de
// atender, percorremos a lista e a primeira que casar ganha.
//
// Para meia dúzia de rotas uma lista linear é mais do que suficiente; uma
// árvore (radix tree, como a do find-my-way do Fastify) só compensa com
// centenas de rotas.

/**
 * Contexto que todo handler recebe.
 * @typedef {object} Contexto
 * @property {import("node:http").IncomingMessage} req
 * @property {import("node:http").ServerResponse} res
 * @property {URL} url
 * @property {Record<string, string>} params parâmetros do caminho (:id)
 * @property {string} correlationId
 */

/**
 * O que um handler devolve: uma resposta pronta (ver responder.js) ou
 * `null` quando ele mesmo já escreveu no `res` (caso do SSE).
 * @typedef {{ status: number, corpo?: unknown, headers?: Record<string, string> } | null} Resposta
 */

/** @typedef {(ctx: Contexto) => Promise<Resposta>} Handler */

export class Roteador {
  constructor() {
    /** @type {{ metodo: string, regex: RegExp, nomes: string[], handler: Handler }[]} */
    this.rotas = [];
  }

  /**
   * @param {string} metodo GET, POST, PATCH, PUT ou DELETE
   * @param {string} padrao caminho com parâmetros no formato :nome
   * @param {Handler} handler
   */
  adicionar(metodo, padrao, handler) {
    const nomes = [];
    const fonte = padrao
      .split("/")
      .map((seg) => {
        if (seg.startsWith(":")) {
          nomes.push(seg.slice(1));
          return "([^/]+)";
        }
        // escapa qualquer caractere especial de regex que apareça no caminho
        return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      })
      .join("/");
    this.rotas.push({ metodo, regex: new RegExp(`^${fonte}/?$`), nomes, handler });
    return this;
  }

  /** @param {string} p @param {Handler} h */
  get(p, h) {
    return this.adicionar("GET", p, h);
  }
  /** @param {string} p @param {Handler} h */
  post(p, h) {
    return this.adicionar("POST", p, h);
  }
  /** @param {string} p @param {Handler} h */
  put(p, h) {
    return this.adicionar("PUT", p, h);
  }
  /** @param {string} p @param {Handler} h */
  patch(p, h) {
    return this.adicionar("PATCH", p, h);
  }
  /** @param {string} p @param {Handler} h */
  delete(p, h) {
    return this.adicionar("DELETE", p, h);
  }

  /**
   * Procura a rota para (método, caminho).
   *   - achou:                     { handler, params }
   *   - caminho existe, método não: { metodosPermitidos: [...] }  -> 405
   *   - não existe:                 null                           -> 404
   * @param {string} metodo
   * @param {string} caminho
   */
  encontrar(metodo, caminho) {
    const metodosPermitidos = [];
    for (const r of this.rotas) {
      const m = r.regex.exec(caminho);
      if (!m) continue;
      if (r.metodo !== metodo && !(metodo === "HEAD" && r.metodo === "GET")) {
        metodosPermitidos.push(r.metodo);
        continue;
      }
      /** @type {Record<string, string>} */
      const params = {};
      r.nomes.forEach((nome, i) => {
        // decodeURIComponent pode lançar com "%E0%A4%A"; tratamos como 404 lá fora
        params[nome] = decodeURIComponent(m[i + 1]);
      });
      return { handler: r.handler, params };
    }
    return metodosPermitidos.length ? { metodosPermitidos } : null;
  }
}
