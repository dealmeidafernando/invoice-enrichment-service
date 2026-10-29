# 0006. Consumo idempotente da mensagem de volta

- Status: Aceito
- Data: 2026-10-29

## Contexto

O enunciado diz que **a resposta do provedor pode chegar mais de uma vez** e que **a mesma mensagem de volta, entregue de novo, não muda a nota outra vez**. O mesmo vale para a nossa fila (ADR 0003) e para o outbox (ADR 0004): os dois são *at-least-once*.

Três situações diferentes precisam ser tratadas:

1. **Reentrega:** a mesma mensagem (mesmo `messageId`) chega de novo, em sequência ou em paralelo.
2. **Resultado diferente para a mesma chave:** o provedor manda um segundo resultado, com outro `messageId`, depois que a nota já foi decidida.
3. **Chave inexistente:** "a mensagem de volta não cria nota; se a chave não existir, o consumo encerra sem gravar".

## Opções avaliadas

1. **Só uma guarda de status** (`UPDATE ... WHERE status = 'ANALISE'`). Impede que a nota mude depois de decidida e cobre os casos 1 e 2. Em troca, não distingue uma reentrega de uma mensagem nova e não deixa registro do que já foi processado.
2. **Só uma tabela inbox** (`processed_messages (consumer, message_id)`). Deduplica a reentrega (caso 1). Sozinha, não impede o caso 2, porque um `messageId` novo passaria e sobrescreveria a decisão.
3. **Inbox + guarda de status + lock da nota.** Tudo numa transação:
   1. `SELECT ... FOR UPDATE` na nota pela chave. Se ela não existe, encerra sem gravar nada.
   2. Registra o `messageId` no inbox. Se já existia, é reentrega e encerra.
   3. Aplica o resultado no domínio. Se a nota já está num status terminal, o resultado é ignorado.
   4. Grava com `WHERE status = 'ANALISE'`.

## Decisão

Opção 3: inbox, guarda de status e lock da nota, numa única transação.

## Motivo

- **Reentrega (1):** o inbox reconhece o `messageId` e o processamento termina como `DUPLICATE`.
- **Reentregas em paralelo:** o lock da nota serializa as duas. A segunda só lê o inbox depois do commit da primeira e encontra o `messageId` já registrado.
- **Resultado diferente (2):** o status terminal faz o domínio devolver `IGNORED`, e a guarda no `UPDATE` protege mesmo se o código errar. O primeiro resultado vale.
- **Chave inexistente (3):** a nota é buscada **antes** do inbox. Se ela não existe, nada é gravado, nem o inbox.
- **Falha no meio do processamento:** inbox e nota estão na mesma transação. Se algo falha, os dois são desfeitos e a reentrega processa a mensagem normalmente.

## Consequências

- Cada processamento termina com um resultado explícito (`APPROVED`, `REJECTED`, `IGNORED`, `DUPLICATE` ou `INVOICE_NOT_FOUND`), registrado em log com `messageId` e `correlationId`.
- Uma mensagem para chave inexistente é confirmada (ack) e não volta. A suposição é que o provedor só responde chaves que pedimos.
- A tabela `processed_messages` cresce sem limite. A limpeza fica fora do escopo.
