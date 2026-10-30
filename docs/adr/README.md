# Architecture Decision Records

Registro das decisões técnicas relevantes do serviço. Cada ADR descreve o contexto, as opções avaliadas, a decisão tomada e o motivo.

| ADR                                                    | Título                                      | Status |
| ------------------------------------------------------ | ------------------------------------------- | ------ |
| [0001](0001-arquitetura-em-camadas-simplificada.md)    | Arquitetura em camadas simplificada         | Aceito |
| [0002](0002-testes-de-integracao-com-postgres-real.md) | Testes de integração com PostgreSQL real    | Aceito |
| [0003](0003-fila-simulada-em-tabela.md)                | Fila simulada em tabela no PostgreSQL       | Aceito |
| [0004](0004-transactional-outbox.md)                   | Transactional Outbox para a mensagem de ida | Aceito |
| [0005](0005-chave-de-acesso-duplicada.md)              | Chave de acesso duplicada                   | Aceito |
| [0006](0006-consumo-idempotente.md)                    | Consumo idempotente da mensagem de volta    | Aceito |
| [0007](0007-contrato-das-mensagens.md)                 | Contrato das mensagens                      | Aceito |
| [0008](0008-processo-unico-para-api-e-workers.md)      | Processo único para API e workers           | Aceito |

## Modelo

```markdown
# NNNN. Título

- Status: Aceito
- Data: AAAA-MM-DD

## Contexto

O problema e as restrições que motivam a decisão.

## Opções avaliadas

1. **Opção A** — descrição curta, prós e contras.
2. **Opção B** — ...

## Decisão

A opção escolhida.

## Motivo

Por que essa opção e não as outras.

## Consequências

O que muda, o que fica mais fácil ou mais difícil, e o que fica pendente.
```
