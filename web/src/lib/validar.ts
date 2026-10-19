import { invalido } from "./erros";

// Validação escrita à mão: pequena, explícita e com mensagens em português.
type Regra = {
  obrigatorio?: boolean;
  min?: number;
  max?: number;
  regex?: RegExp;
  valores?: readonly string[];
  nome: string;
};

export function texto(corpo: Record<string, unknown>, campo: string, r: Regra): string | undefined {
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

export const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
