# 04 · Embeddings

Um **embedding** é um texto transformado em uma lista de números (um vetor) de um jeito
que textos de significado parecido viram vetores parecidos.

```
"verifica o token JWT"          → [0.12, -0.03, 0.88, ...]
"validate access token"         → [0.10, -0.01, 0.85, ...]   ← perto
"renderiza o rodapé da página"  → [-0.40, 0.67, 0.02, ...]   ← longe
```

É o que permite achar `validateAccessToken()` quando a pergunta é "onde o token é
verificado?", mesmo sem nenhuma palavra em comum.

## Medindo "perto": cosseno

Dois vetores apontam para direções; quanto menor o ângulo entre eles, mais parecidos.
A **similaridade de cosseno** vai de 1 (mesma direção) a 0 (nada a ver).

Todo vetor é **normalizado** (comprimento 1) quando é gerado (`normalizar()` em
`api/src/llm/embeddings.js`). Com isso o cosseno vira um produto escalar simples:

```js
let s = 0;
for (let i = 0; i < n; i++) s += a[i] * b[i];
return s;
```

## Os dois provedores

`api/src/llm/embeddings.js` esconde dois provedores atrás da mesma interface
(`embedDocumentos()` para o índice, `embedConsulta()` para a pergunta).

### Com OpenAI: `text-embedding-3-small`

Com `LLM_API_KEY` no `.env`, o padrão é `text-embedding-3-small` (1536 dimensões) via
`POST /v1/embeddings`. É barato e entende sinônimos, inclusive entre português e inglês
("autenticação" fica perto de "login").

Qualquer provedor que fale o formato da OpenAI serve: basta trocar `LLM_BASE_URL` e
`LLM_EMBED_MODEL` (o `nomic-embed-text` do Ollama, por exemplo, que pede os prefixos
`EMBED_PREFIX_DOC` e `EMBED_PREFIX_QUERY`).

### Sem LLM: hashing de termos

Sem chave (ou com `LLM_EMBED_MODEL=local`), o vetor é calculado localmente, sem rede,
por *feature hashing* (`embedLocal()`):

1. o texto é tokenizado (`verifyToken` → `verifytoken`, `verify`, `token`);
2. cada termo passa por um hash (FNV-1a) que escolhe uma das 512 posições do vetor;
3. a posição recebe o peso do termo (`1 + log(frequência)`), com sinal + ou − pelo
   bit mais alto do hash (reduz o efeito de dois termos caírem na mesma posição);
4. trigramas de caractere dos termos longos entram com peso menor, para aproximar
   variações (`token` / `tokens`, `verify` / `verifier`).

Isso captura **sobreposição de vocabulário**, não significado: "login" e "signin" ficam
longe. Por isso a busca tem um glossário PT → EN de conceitos
([05](05-busca-hibrida.md#antes-de-buscar-entender-a-pergunta)) e não depende só do
vetor. O modo local existe para o projeto rodar em qualquer máquina e como linha de
base para comparar com um modelo de verdade.

## O que vai para o embedding

Não só o código. O texto embedado é:

```
arquivo: src/auth/jwt.ts > classe JwtService > método assinar
assinar(payload: object) {
  const corpo = JSON.stringify(payload);
  ...
```

O cabeçalho ([03](03-chunking.md#o-cabeçalho)) dá contexto a trechos que sozinhos não
dizem do que tratam.

## Reaproveitamento pelo hash

Gerar embedding custa tempo e, com a OpenAI, dinheiro. Então cada chunk guarda
`hashTexto`:

```
hashTexto = sha256(nome do modelo + "\0" + cabeçalho + "\n" + conteúdo)
```

Antes de pedir vetores, a indexação carrega `hashTexto → embedding` de tudo que já
está no banco (`cacheEmbeddings()`) e só pede os que faltam. Consequências:

- **Mover uma função de linha não gera embedding novo:** o texto é o mesmo, o hash é o
  mesmo. Só `linhaInicio`/`linhaFim` mudam.
- **Trocar de modelo invalida tudo:** o nome do modelo entra no hash, e vetores de
  modelos diferentes não são comparáveis. O repositório guarda `embedModelo`; se ele
  não bater com o modelo atual, a indexação é completa e a busca vetorial avisa
  "sincronize os repositórios".

O resultado aparece na tela do repositório em "última indexação":
`embeddingsGerados` e `embeddingsReaproveitados`.

## Velocidade e falhas no meio do caminho

Um repositório médio passa de 3 mil chunks. Com a OpenAI isso é rápido, desde que:

- **lotes grandes e em paralelo**: até 128 textos (ou ~80 mil tokens) por requisição,
  4 requisições ao mesmo tempo (`LOTE_TEXTOS`, `LOTE_CARACTERES`, `PARALELAS`);
- **texto cortado em 16 mil caracteres**: o modelo aceita até 8191 tokens por texto e
  recusa o lote inteiro se um passar. Um bloco de JSON minificado passa fácil;
- **429 não derruba nada**: limite de taxa e erro 5xx são tentados de novo na hora,
  respeitando o `Retry-After` (`api/src/llm/requisicao.js`);
- **checkpoint**: cada lote pronto vai para a coleção `embeddings_checkpoint`. Se a
  indexação cair no meio, a próxima tentativa continua de onde parou. Depois que os
  chunks são gravados o checkpoint é apagado; sobras expiram em 7 dias.

## Pergunta e documento

A pergunta também vira vetor (`embedConsulta()`), mas o texto embedado é a pergunta
**mais os termos de busca** já traduzidos (`consulta.original + consulta.termosBusca`).
Isso ajuda até o embedding local a casar "autenticação" com `auth`.

Anterior: [03 · Chunking](03-chunking.md) · Próximo: [05 · Busca híbrida](05-busca-hibrida.md)
