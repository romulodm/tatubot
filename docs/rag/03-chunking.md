# 03 · Chunking

O chunk é a **unidade** de tudo: é o que a busca devolve, o que vai no prompt e o que
é citado. Se o corte for ruim, nada depois conserta.

## Por que não cortar a cada N linhas?

Porque o código tem estrutura e o corte cego a ignora:

```js
// linhas 1–60 viram um chunk, 61–120 outro...
export async function verificarToken(token) {    // linha 55
  const partes = token.split(".");               // linha 56
  ...                                            // linhas 57–60
}                                                // (continua no chunk seguinte)
```

A busca acha metade da função, o modelo vê metade da lógica e a citação aponta para
linhas soltas. O tatubot corta **pela estrutura**, em `api/src/indexacao/chunker.js`.

## JS e TS: pela AST

Para `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs` usamos o compilador do TypeScript
**só como parser**: ele lê o arquivo e devolve a árvore sintática (AST) com a posição
exata de cada declaração. Nada é compilado.

Percorrendo o nível de cima do arquivo:

| Encontrou | Vira | Símbolo |
|---|---|---|
| `function verificarToken() {}` | chunk `funcao` | `verificarToken` |
| `const handler = async () => {}` | chunk `funcao` | `handler` |
| `const h = withAuth(async () => {})` | chunk `funcao` | `h` |
| `class JwtService { ... }` | chunk `classe` (resumo) + um `metodo` por método | `JwtService`, `JwtService.assinar` |
| `app.get("/rota", async (req, res) => {...})` | chunk `funcao` | `app.get('/rota')` |
| `export default () => {}` | chunk `funcao` | `default` |
| o que sobrou (imports, constantes, config) | chunk `modulo` | — |

Detalhes que fazem diferença:

- **O JSDoc vem junto.** O início do chunk é `getStart(sf, true)`, que inclui o
  comentário de documentação. A descrição da função costuma ser o melhor texto para a
  busca por significado.
- **Resumo da classe.** O chunk `classe` vai do cabeçalho até antes do primeiro método
  (campos, `extends`) e termina com `// métodos: constructor, assinar`. Cada método
  ganha um chunk próprio.
- **Funções longas são fatiadas** em partes de até 120 linhas, com 15 linhas
  repetidas entre uma parte e a próxima (`fatiar()`), para a emenda não perder
  contexto. O símbolo vira `nome (parte 2)`.
- **Funções minúsculas são agrupadas.** Funções e métodos com menos de 5 linhas,
  vizinhos, viram um chunk só (`agruparPequenos()`): `getNome, setNome`. Sozinhas
  seriam ruído na busca.
- **Se o parse falhar** (sintaxe que o parser não entende), o arquivo cai no corte
  por linhas. Melhor esforço em vez de perder o arquivo.

### O cabeçalho

Cada chunk ganha um `cabecalho` com o contexto que o trecho sozinho não tem:

```
arquivo: src/auth/jwt.ts > classe JwtService > método assinar
```

O cabeçalho vai **junto do conteúdo no embedding**. Assim, um método chamado só
`assinar()` ainda carrega "jwt", "auth" e "JwtService" no vetor.

### As referências

Durante o percurso da AST, cada chunk anota os nomes que chama: `verificarToken()`,
`this.log()`, `new JwtService()`. Isso vira o campo `referencias`, usado em dois
lugares:

- na **expansão por grafo** da busca: quem os melhores resultados chamam, e quem os
  chama ([05](05-busca-hibrida.md#4-expansão-por-grafo));
- na ferramenta **`referencias`** do agente ("quem chama essa função?").

Nos chunks `modulo` as referências são os módulos importados (`from "jose"`).

## Markdown: por seção

Para `.md` e `.mdx`, um chunk por heading (`#`, `##`, `###`), com a trilha de títulos
no cabeçalho:

```
arquivo: README.md > Projeto > Instalação > Docker
```

Headings dentro de blocos de código (` ``` `) não contam. Seções longas são fatiadas
igual às funções.

## O resto: blocos com sobreposição

Python, Go, YAML, CSS... viram blocos de 60 linhas com 10 de sobreposição. É o corte
cego, mas é o melhor que dá sem um parser por linguagem. Suportar outras linguagens
pela estrutura (com tree-sitter, por exemplo) é uma melhoria natural.

## Como testar

`api/test/chunker.test.js` tem um arquivo de exemplo com função, classe, métodos e
handler, e confere símbolos, linhas, cabeçalho e referências:

```bash
cd api && npm test
```

Anterior: [02 · Indexação](02-indexacao.md) · Próximo: [04 · Embeddings](04-embeddings.md)
