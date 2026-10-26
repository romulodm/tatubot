# 07 · Reindexação incremental

Reindexar tudo a cada push funciona, mas desperdiça tempo e embeddings. Na maioria dos
pushes, poucos arquivos mudam.

## Como chega o aviso

Dois caminhos publicam `repo.sincronizar`:

- **botão "sincronizar"** na tela do repositório (`POST /api/repos/:id/sincronizar`,
  limitado a 6 por minuto);
- **webhook do GitHub** (`POST /api/webhooks/github/:repoId`).

### Configurando o webhook

Na tela do repositório aparecem a URL e o segredo. No GitHub: *Settings → Webhooks →
Add webhook*, com `Content type: application/json`, o segredo e o evento *Just the push
event*. O GitHub precisa alcançar a URL, então em desenvolvimento use um túnel
(ngrok, cloudflared) apontando para a porta 3000.

A rota é pública; a autenticação é a assinatura:

```
X-Hub-Signature-256: sha256=<HMAC-SHA256(corpo cru, segredo do repositório)>
```

Recalculamos sobre os **bytes exatos** recebidos e comparamos com `timingSafeEqual`
(`api/src/rotas/repos.js`). Repositório inexistente e assinatura errada recebem a
mesma resposta, para não revelar quais ids existem. Push em outra branch é ignorado.

O GitHub entrega "pelo menos uma vez": o mesmo push pode chegar duas vezes. O header
`X-GitHub-Delivery` vira o `eventId` do evento, que é a chave primária na fila; a
segunda entrega bate em chave duplicada e é descartada.

## Decidindo o tipo de indexação

Em `indexar()` (`api/src/indexacao/indexar.js`), se o clone existe e o modelo de
embedding é o mesmo da última vez:

```
git fetch origin <branch>  ─►  novo = FETCH_HEAD
  │
  ├─ novo == ultimoCommit                  ─► "nada" (só atualiza o status)
  ├─ ultimoCommit é ancestral de novo      ─► "incremental"
  └─ não é ancestral (force push, rebase)  ─► "completa"
```

`git merge-base --is-ancestor` responde se o commit antigo ainda está no histórico do
novo. Depois de um force push ele não está, e um diff entre os dois não teria sentido.

## O incremental

```
git diff --name-status -M -z <antigo> <novo>
```

- `A`/`M` (adicionado, modificado): reprocessar;
- `D` (removido): apagar do índice;
- `R` (renomeado): apagar o caminho antigo, processar o novo.

`-M` liga a detecção de renomeação independentemente da configuração local do git;
`-z` separa por `\0`, então nomes com espaço ou acento não quebram o parse.

Os arquivos tocados passam pelo mesmo pipeline da indexação completa (filtros,
segredos, chunks). Os chunks dos arquivos **não** tocados só ganham o `commitSha` novo,
para os links do GitHub apontarem para o commit atual.

## Por que quase nenhum embedding é gerado

Mesmo dentro dos arquivos modificados, a maioria das funções não mudou de texto. Como o
reaproveitamento é pelo **hash do texto** ([04](04-embeddings.md#reaproveitamento-pelo-hash)),
não pela posição:

- adicionar uma função no topo do arquivo empurra as outras para baixo, mas elas
  mantêm o embedding;
- renomear um arquivo muda o cabeçalho (o caminho faz parte dele), então esse sim
  gera embeddings novos.

O resultado fica em `ultimaIndexacao`: `modo`, `embeddingsGerados` e
`embeddingsReaproveitados`.

## Trocar de branch

`PATCH /api/repos/:id` com outra branch publica `repo.atualizado_config`: o índice e o
clone são apagados e a indexação recomeça do zero (é outro código).

Anterior: [06 · Resposta e citações](06-resposta-e-citacoes.md) · Próximo: [08 · Ajustando e depurando](08-ajustando-e-depurando.md)
