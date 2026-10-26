# 02 · Indexação

Indexar é transformar um repositório do GitHub em algo que dá para buscar: uma lista
de trechos (*chunks*), cada um com seu texto, suas linhas, seus termos e seu vetor.

## Quem dispara

Nenhuma rota HTTP indexa nada. Ela grava o estado e publica um evento na fila:

| Ação do usuário | Evento | Rota |
|---|---|---|
| Cadastrar repositório | `repo.cadastrado` | `POST /api/repos` |
| Botão "sincronizar" | `repo.sincronizar` | `POST /api/repos/:id/sincronizar` |
| Push no GitHub (webhook) | `repo.sincronizar` | `POST /api/webhooks/github/:repoId` |
| Trocar a branch | `repo.atualizado_config` | `PATCH /api/repos/:id` |
| Remover | `repo.removido` | `DELETE /api/repos/:id` |

O **worker** (`api/src/worker.js`) consome esses eventos com concorrência 1
(`api/src/fila.js`): duas sincronizações do mesmo repositório nunca
rodam ao mesmo tempo. A requisição volta na hora; a tela de repositórios acompanha
o campo `progresso` do documento.

> Por que fila? Clonar e gerar embeddings de um repositório grande leva minutos.
> Segurar uma requisição HTTP esse tempo todo seria frágil (timeout, reinício do
> servidor). Com a fila, se o worker cair no meio, o evento volta a ficar disponível
> e é retomado. Ver [`arquitetura.md`](../arquitetura.md#a-fila).

## O caminho de um repositório

Tudo começa em `indexar()` (`api/src/indexacao/indexar.js`):

```
indexar(repoId)
  │
  ├─ repo sumiu do banco? ──► descarta o evento (foi removido enquanto esperava)
  │
  ├─ já tem clone + mesmo modelo de embedding?
  │     sim ─► git fetch ─┬─ mesmo commit ─────────► "nada"
  │                       ├─ commit novo, histórico ok ► "incremental" (07)
  │                       └─ force push ──────────────► "completa"
  │     não ─► git clone ──────────────────────────────► "completa"
  │
  └─ status "pronto", totais, versaoIndice + 1
```

### 1. Clonar

`api/src/indexacao/git.js`. Clone **raso** (`--depth 50 --single-branch`): só os
últimos 50 commits da branch, o suficiente para comparar versões sem baixar anos de
histórico. Branch vazia significa "a padrão do repositório" (`main`, `master`,
`trunk`...), descoberta depois do clone.

O `git` roda com `spawn` e **sem shell**, com a URL depois de `--`. A URL foi validada
por regex no cadastro e remontada a partir do owner e do nome, mas mesmo que algo
estranho passasse, nunca seria interpretado como comando.

### 2. Listar

`git ls-files`: só arquivos rastreados. Isso já respeita o `.gitignore` do
repositório sem precisarmos reimplementar o parser dele. Limite de 4000 arquivos por
repositório (`config.limites.arquivosPorRepo`).

### 3. Filtrar

`api/src/indexacao/filtros.js`. Do mais barato ao mais caro:

| Filtro | Exemplo | Motivo gravado |
|---|---|---|
| Pasta ignorada | `node_modules/`, `dist/`, `.next/`, `vendor/` | `diretorio_ignorado` |
| Lockfile | `package-lock.json`, `yarn.lock` | `lockfile` |
| Minificado / source map | `app.min.js`, `app.js.map` | `minificado` |
| Extensão binária | `.png`, `.pdf`, `.woff2` | `binario` |
| Symlink | qualquer um | `symlink` |
| Grande demais | > 200 KB | `grande_demais` |
| Byte nulo nos primeiros 8 KB | binário sem extensão | `binario` |

Symlinks são ignorados com `lstat` (que não segue o link) porque poderiam apontar para
fora do clone, por exemplo para `/etc/passwd`.

### 4. Varrer segredos

`api/src/indexacao/filtros.js`. Antes de qualquer chunk, cada arquivo passa por:

- **nome**: `.env*` (exceto `.env.example`, `.sample`...), `*.pem`, `*.key`, `id_rsa`,
  `credentials.json`;
- **conteúdo**: chave privada, token do GitHub, chave da OpenAI, AWS, Slack, Google,
  Stripe, URL com senha.

Se bater, o arquivo inteiro é ignorado com o motivo `segredo_detectado:<tipo>`. Ele
nunca vira chunk, então nunca vai para embedding, prompt ou resposta. A ferramenta
`ler_arquivo` do agente também só lê arquivos com status `indexado`, então não
existe caminho para o segredo chegar ao modelo.

É uma lista conservadora: perder um arquivo é melhor do que mandar uma chave de
produção para uma API externa.

### 5. Quebrar em chunks

`quebrarEmChunks()` em `api/src/indexacao/chunker.js`. Assunto do
[capítulo 03](03-chunking.md).

### 6. Gerar embeddings

Em lotes de 32 textos, com reaproveitamento pelo hash do texto
(`embeddar()` em `indexar.js`). Assunto do [capítulo 04](04-embeddings.md).

### 7. Gravar

Duas coleções:

- `arquivos`: um documento por arquivo, com `status` (`indexado`, `ignorado`, `erro`) e
  `motivo`. É o que aparece na tela do repositório em "arquivos ignorados".
- `chunks`: um documento por trecho, com `path`, `linhaInicio`, `linhaFim`, `simbolo`,
  `conteudo`, `embedding`, `tokens` (para o BM25) e `referencias` (para o grafo).

Na indexação completa o índice antigo só é apagado **depois** que o novo está pronto
em memória, então a busca segue funcionando durante a indexação.

No fim, o repositório ganha `status: "pronto"` e `versaoIndice + 1`. Esse número
invalida o cache da busca (ver [05](05-busca-hibrida.md#o-índice-em-memória)).

## Quando dá errado

| Erro | Tipo | O que acontece |
|---|---|---|
| Repositório ou branch não existe, repositório privado | `ErroPermanente` | Vai direto para a DLQ; repo fica com `status: "erro"` e a mensagem |
| Rede caiu, API de embedding fora do ar | `ErroTransitorio` | Volta para a fila: tenta de novo em 5 s, 30 s e 2 min |
| Esgotou as tentativas | | DLQ; repo com `status: "erro"` |

Um arquivo que falha ao ser lido não derruba a indexação: ele fica com `status: "erro"`
e o motivo, e o resto segue.

Anterior: [01 · O que é RAG](01-o-que-e-rag.md) · Próximo: [03 · Chunking](03-chunking.md)
