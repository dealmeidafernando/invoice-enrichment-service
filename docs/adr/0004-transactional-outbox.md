# 0004. Transactional Outbox para a mensagem de ida

- Status: Aceito
- Data: 2026-10-29

## Contexto

No request do cliente, o serviço grava a nota e publica a mensagem de ida para o provedor. A regra do enunciado é clara: **falha ao publicar não pode perder a nota nem aprová-la no request**.

Gravar no banco e publicar no broker são duas operações em sistemas diferentes, sem transação comum. Qualquer ordem ingênua tem uma janela em que uma acontece e a outra não.

## Opções avaliadas

1. **Publicar dentro do request, depois do `INSERT`.** Se a publicação falha, ou o request falha com a nota já gravada (estado ambíguo para o cliente) ou a transação é desfeita e a nota se perde. Além disso, o request fica acoplado à disponibilidade do broker.
2. **Commit e depois publicar, com retry em memória.** Se o processo cai entre o commit e a publicação, a nota fica em `ANALISE` para sempre, sem mensagem.
3. **Transactional Outbox.** A nota e a mensagem são gravadas na mesma transação (tabela `outbox`). Um relay, fora do request, lê as mensagens pendentes e publica. Se a publicação falha, a mensagem continua `PENDING` e volta a ser tentada com backoff.

## Decisão

Opção 3: Transactional Outbox, com o `OutboxRelay` rodando em segundo plano.

## Motivo

- Nota e mensagem são atômicas: ou existem as duas, ou nenhuma. A nota nunca fica sem a mensagem de ida.
- O request nunca fala com o broker: responde `202` com a nota em `ANALISE`, e a aprovação só acontece depois do resultado.
- Uma falha ao publicar só atrasa o envio. A nota não é perdida nem aprovada.
- Vários relays em paralelo não publicam a mesma linha (`FOR UPDATE SKIP LOCKED`).

## Consequências

- A entrega é *at-least-once*: se o relay publica e cai antes de marcar `PUBLISHED`, a mensagem sai de novo. Por isso o consumidor precisa ser idempotente (ADR 0006).
- Existe uma latência pequena entre o request e a publicação, de um ciclo do relay.
- O repositório de outbox exige uma transação aberta e falha se for chamado fora dela, para evitar uso incorreto.
