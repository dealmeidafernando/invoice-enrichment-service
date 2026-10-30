# 0005. Chave de acesso duplicada

- Status: Aceito
- Data: 2026-10-29

## Contexto

Regra do enunciado: **a mesma chave não pode gerar duas notas.**

Na prática, o cliente reenvia a mesma chave por vários motivos: timeout no primeiro request, retry automático do cliente HTTP ou duplo clique. Os dois requests podem chegar ao mesmo tempo, em instâncias diferentes da API.

Duas perguntas precisam de resposta:

1. Como **garantir** que só existe uma nota por chave, inclusive sob concorrência?
2. O que **responder** no segundo request?

## Opções avaliadas

**Garantia de unicidade:**

1. **`SELECT` antes do `INSERT` na aplicação.** É simples de ler, mas tem condição de corrida: dois requests simultâneos não encontram a nota e os dois inserem.
2. **Constraint `UNIQUE (access_key)` + `INSERT ... ON CONFLICT DO NOTHING`.** O banco garante a unicidade, de forma atômica, mesmo com requests simultâneos.

**Resposta ao segundo request:**

- **(a) `409 Conflict`.** Deixa claro que a chave já existia, mas transforma um retry legítimo em erro. O cliente precisa tratar o 409 e buscar a nota por outro caminho.
- **(b) `200 OK` com a nota existente.** O endpoint vira idempotente: o cliente recebe o mesmo `id` e pode acompanhar o status. O primeiro request responde `202 Accepted`.

## Decisão

Constraint `UNIQUE` + `INSERT ... ON CONFLICT DO NOTHING`, e **resposta idempotente**:

| Situação            | Status                      | Corpo                         |
| ------------------- | --------------------------- | ----------------------------- |
| Chave nova          | `202 Accepted` + `Location` | nota em `ANALISE`             |
| Chave já registrada | `200 OK` + `Location`       | a mesma nota, no status atual |
| Chave inválida      | `400 Bad Request`           | `code: INVALID_ACCESS_KEY`    |

## Motivo

- O `SELECT` antes do `INSERT` não resiste à concorrência. Só o banco garante a unicidade de verdade.
- O cenário mais comum para a mesma chave é um retry do mesmo cliente. Uma resposta idempotente é mais útil do que um erro: o cliente não precisa de lógica extra e recebe o `id` da nota de qualquer jeito.
- `202` e `200` continuam diferenciando "criada agora" de "já existia", sem precisar de erro para isso.

## Consequências

- O segundo request **não grava outra mensagem de ida**: a mensagem só vai para o outbox quando a nota é criada. Isso evita pedir o enriquecimento duas vezes.
- Se dois requests chegam juntos, o `ON CONFLICT` espera a transação do outro terminar. O primeiro cria a nota e o segundo lê a nota que já existe.
- A validação da chave (44 dígitos e dígito verificador módulo 11) acontece antes de tocar no banco. Uma chave inválida não grava nada.
