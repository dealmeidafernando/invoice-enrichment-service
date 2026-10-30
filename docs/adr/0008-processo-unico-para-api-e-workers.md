# 0008. Processo único para API e workers

- Status: Aceito
- Data: 2026-10-29

## Contexto

Além da API HTTP, o serviço tem trabalho em segundo plano:

- o **relay do outbox**, que publica a mensagem de ida (ADR 0004);
- o **consumidor do resultado**, que processa a mensagem de volta (ADR 0006);
- na demo, o **provedor simulado**, que responde às mensagens de ida.

O enunciado pede um `docker compose` que suba "a API e o PostgreSQL" e permite simular a fila "no próprio processo ou com uma tabela".

## Opções avaliadas

1. **Um processo só.** A API e os loops de segundo plano rodam juntos, e flags de ambiente ligam e desligam cada parte. O compose fica com dois serviços: `api` e `postgres`.
2. **Um container `worker` separado,** com a mesma imagem e um `APP_ROLE` diferente. A API e os workers escalam de forma independente, mas o compose ganha um serviço e a explicação fica mais longa.
3. **NestJS microservices ou `@nestjs/schedule`** para os loops. Usa abstrações prontas, mas acrescenta dependência e configuração para algo que é um loop de polling de poucas linhas.

## Decisão

Opção 1: um processo só, com duas flags.

| Variável            | Padrão  | Função                                                     |
| ------------------- | ------- | ---------------------------------------------------------- |
| `WORKERS_ENABLED`   | `true`  | liga o relay do outbox e o consumidor do resultado         |
| `SIMULATE_PROVIDER` | `false` | liga o provedor simulado; o compose usa `true` para a demo |

## Motivo

- Segue o que o enunciado pede: o compose sobe a API e o PostgreSQL, e nada mais.
- É o mais simples de rodar e de explicar: um container, um log.
- Rodar várias réplicas continua seguro: a fila e o outbox usam `FOR UPDATE SKIP LOCKED`, então duas instâncias nunca processam a mesma linha.
- Separar o worker depois exige só uma flag a mais, sem mudar código.

## Consequências

- HTTP e processamento em segundo plano escalam juntos. Para este volume isso não é problema; num cenário real, separar seria o primeiro passo.
- Cada loop roda sem sobreposição (a próxima execução só é agendada quando a atual termina), e o shutdown espera a execução em andamento.
- Nos testes, `WORKERS_ENABLED=false`: cada teste avança relay → provedor → consumidor manualmente, então o resultado é determinístico.
- Em produção, `SIMULATE_PROVIDER` fica desligado, porque o provedor é outro sistema.
