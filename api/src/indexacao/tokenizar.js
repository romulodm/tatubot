// Tokenização para a busca textual (BM25) e para o embedding local.
//
// Código não é prosa: "verifyAccessToken" precisa casar com uma busca por
// "token". Então cada identificador é quebrado nas suas partes
//   verifyAccessToken -> verifyaccesstoken, verify, access, token
//   auth_guard        -> auth_guard, auth, guard
// e o identificador inteiro também entra, para casar buscas exatas.

// Palavras que aparecem em tudo e não ajudam a diferenciar trechos.
const STOP = new Set(
  (
    "a o e de da do das dos que em um uma para com por no na nos nas se como mais ao os as é ou the of and to in is it for on with as be this that are by an at from or not " +
    "const let var function return import export from if else new true false null undefined"
  ).split(" "),
);

/**
 * @param {string} texto
 * @returns {string[]} termos normalizados (minúsculos, sem acento), com repetição
 */
export function tokenizar(texto) {
  const saida = [];
  const brutos = texto.match(/[A-Za-z_$][A-Za-z0-9_$]*|[0-9]+|[À-ÿ]+/g) ?? [];
  for (const b of brutos) {
    const inteiro = normalizar(b);
    if (inteiro.length < 2 || inteiro.length > 60) continue;
    const partes = b
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2") // camelCase -> camel Case
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2") // HTTPServer -> HTTP Server
      .split(/[\s_$]+/)
      .map(normalizar)
      .filter((p) => p.length >= 2);
    if (partes.length > 1) {
      saida.push(inteiro);
      for (const p of partes) if (!STOP.has(p)) saida.push(p);
    } else if (!STOP.has(inteiro)) {
      saida.push(inteiro);
    }
  }
  return saida;
}

/** "Autenticação" -> "autenticacao" @param {string} s */
export function normalizar(s) {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}
