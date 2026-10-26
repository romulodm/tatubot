// Banco em memória com o pedaço da API do driver do Mongo que as rotas usam.
// Serve para testar as rotas sem subir um Mongo. Não é completo nem tenta ser.

function valor(doc, campo) {
  return campo.split(".").reduce((v, k) => (v == null ? undefined : v[k]), doc);
}

function igual(a, b) {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

function casaCampo(v, cond) {
  if (cond && typeof cond === "object" && !Array.isArray(cond) && !(cond instanceof Date)) {
    return Object.entries(cond).every(([op, arg]) => {
      if (op === "$in") return arg.some((x) => (Array.isArray(v) ? v.includes(x) : igual(v, x)));
      if (op === "$ne") return !igual(v, arg);
      if (op === "$gt") return v > arg;
      if (op === "$gte") return v >= arg;
      if (op === "$lt") return v < arg;
      if (op === "$lte") return v <= arg;
      throw new Error(`operador não suportado no banco falso: ${op}`);
    });
  }
  if (Array.isArray(v)) return v.some((x) => igual(x, cond));
  return igual(v, cond);
}

export function casa(doc, filtro = {}) {
  return Object.entries(filtro).every(([k, cond]) => {
    if (k === "$or") return cond.some((f) => casa(doc, f));
    return casaCampo(valor(doc, k), cond);
  });
}

function aplicar(doc, update) {
  for (const [k, v] of Object.entries(update.$set ?? {})) doc[k] = v;
  for (const [k, v] of Object.entries(update.$inc ?? {})) doc[k] = (doc[k] ?? 0) + v;
  for (const [k, v] of Object.entries(update.$push ?? {})) doc[k] = [...(doc[k] ?? []), v];
  for (const [k, v] of Object.entries(update.$pull ?? {})) if (Array.isArray(doc[k])) doc[k] = doc[k].filter((x) => !igual(x, v));
}

function ordenar(docs, sort) {
  if (!sort) return docs;
  const chaves = Object.entries(sort);
  return [...docs].sort((a, b) => {
    for (const [k, dir] of chaves) {
      const x = valor(a, k);
      const y = valor(b, k);
      if (x < y) return -dir;
      if (x > y) return dir;
    }
    return 0;
  });
}

function projetar(doc, projection) {
  if (!projection) return structuredClone(doc);
  const incluir = Object.entries(projection).filter(([, v]) => v);
  const r = {};
  for (const [k] of incluir) if (k in doc) r[k] = structuredClone(doc[k]);
  if (projection._id !== 0 && !("_id" in r)) r._id = doc._id;
  return r;
}

class Cursor {
  constructor(docs, projection) {
    this.docs = docs;
    this.projection = projection;
    this.opts = {};
  }
  sort(s) {
    this.opts.sort = s;
    return this;
  }
  skip(n) {
    this.opts.skip = n;
    return this;
  }
  limit(n) {
    this.opts.limit = n;
    return this;
  }
  async toArray() {
    let r = ordenar(this.docs, this.opts.sort);
    if (this.opts.skip) r = r.slice(this.opts.skip);
    if (this.opts.limit) r = r.slice(0, this.opts.limit);
    return r.map((d) => projetar(d, this.projection));
  }
}

class Colecao {
  constructor() {
    this.docs = [];
    this.unicos = [];
  }

  async createIndex(chaves, opcoes = {}) {
    if (opcoes.unique) this.unicos.push(Object.keys(chaves));
  }

  conferirUnico(doc) {
    const duplicado = (campos) => this.docs.some((d) => d !== doc && campos.every((c) => igual(valor(d, c), valor(doc, c))));
    if (duplicado(["_id"]) || this.unicos.some(duplicado)) {
      throw Object.assign(new Error("E11000 duplicate key"), { code: 11000 });
    }
  }

  async insertOne(doc) {
    const novo = structuredClone(doc);
    this.conferirUnico(novo);
    this.docs.push(novo);
    return { insertedId: novo._id };
  }

  async insertMany(docs) {
    for (const d of docs) await this.insertOne(d);
    return { insertedCount: docs.length };
  }

  find(filtro = {}, opcoes = {}) {
    return new Cursor(
      this.docs.filter((d) => casa(d, filtro)),
      opcoes.projection,
    );
  }

  async findOne(filtro = {}, opcoes = {}) {
    const d = this.docs.find((x) => casa(x, filtro));
    return d ? projetar(d, opcoes.projection) : null;
  }

  async countDocuments(filtro = {}) {
    return this.docs.filter((d) => casa(d, filtro)).length;
  }

  async updateOne(filtro, update) {
    const d = this.docs.find((x) => casa(x, filtro));
    if (d) aplicar(d, update);
    return { matchedCount: d ? 1 : 0 };
  }

  async updateMany(filtro, update) {
    const alvos = this.docs.filter((x) => casa(x, filtro));
    alvos.forEach((d) => aplicar(d, update));
    return { matchedCount: alvos.length };
  }

  async findOneAndUpdate(filtro, update, opcoes = {}) {
    const [d] = ordenar(
      this.docs.filter((x) => casa(x, filtro)),
      opcoes.sort,
    );
    if (!d) return null;
    const antes = structuredClone(d);
    aplicar(d, update);
    return opcoes.returnDocument === "after" ? structuredClone(d) : antes;
  }

  async deleteOne(filtro) {
    const i = this.docs.findIndex((x) => casa(x, filtro));
    if (i >= 0) this.docs.splice(i, 1);
    return { deletedCount: i >= 0 ? 1 : 0 };
  }

  async deleteMany(filtro = {}) {
    const antes = this.docs.length;
    this.docs = this.docs.filter((x) => !casa(x, filtro));
    return { deletedCount: antes - this.docs.length };
  }

  aggregate(pipeline) {
    let docs = this.docs;
    for (const etapa of pipeline) {
      if (etapa.$match) docs = docs.filter((d) => casa(d, etapa.$match));
      else if (etapa.$group) {
        const campo = String(etapa.$group._id).replace(/^\$/, "");
        const grupos = new Map();
        for (const d of docs) grupos.set(valor(d, campo), (grupos.get(valor(d, campo)) ?? 0) + 1);
        docs = [...grupos].map(([_id, n]) => ({ _id, n }));
      } else throw new Error("etapa não suportada no banco falso");
    }
    return { toArray: async () => docs };
  }
}

export function bancoFalso() {
  const colecoes = new Map();
  return {
    collection(nome) {
      if (!colecoes.has(nome)) colecoes.set(nome, new Colecao());
      return colecoes.get(nome);
    },
    async command() {
      return { ok: 1 };
    },
    async dropDatabase() {
      colecoes.clear();
    },
  };
}
