# 0003. Fila simulada em tabela no PostgreSQL

- Status: Aceito
- Data: 2026-10-29

## Contexto

O serviço conversa com o provedor externo por mensagens. Uma vai (pedido de enriquecimento) e outra volta (resultado). O enunciado deixa barramento gerenciado fora do escopo e permite simular a fila "no próprio processo ou com uma tabela, desde que a reentrega exista num teste".

A resposta do provedor pode chegar mais de uma vez. Para ser um teste fiel, a fila simulada precisa se comportar como um broker real: entrega *at-least-once*, ack depois do processamento e reentrega quando o processamento falha.

## Opções avaliadas

1. **Fila em memória no processo** (array ou `EventEmitter`). É a mais simples de escrever. Em troca, perde as mensagens quando o processo reinicia, não tem ack nem visibilidade, e a reentrega acaba simulada "na mão", sem refletir um broker real.
2. **Tabela `queue_messages` no PostgreSQL.** Cada linha é uma entrega. O consumo usa `FOR UPDATE SKIP LOCKED` com timeout de visibilidade, o ack só acontece depois do handler, e uma falha reagenda a mensagem com backoff exponencial até ela virar `DEAD` (dead-letter).
3. **Broker real no compose** (RabbitMQ ou similar). É o mais fiel, mas acrescenta infraestrutura, configuração e um cliente novo, e fica perto do que o enunciado tirou do escopo.

## Decisão

Opção 2: tabela `queue_messages` no PostgreSQL, encapsulada na classe `TableQueue`.

## Motivo

- A reentrega é real e fica testável: a mesma mensagem pode ser entregue mais de uma vez, e uma falha no handler faz a mensagem voltar.
- A fila sobrevive a reinícios e aceita vários consumidores ao mesmo tempo sem duplicar trabalho, graças ao `SKIP LOCKED`.
- Usa o mesmo PostgreSQL que já está no compose, sem infraestrutura nova.
- A opção 1 não demonstra a reentrega de forma honesta. A opção 3 custa mais do que o teste pede.

## Consequências

- A publicação usa uma conexão própria, fora da transação do serviço, como um broker externo faria. Isso mantém honestos os testes de falha ao publicar.
- O consumo é por polling, com latência de cerca de 500 ms (`POLL_INTERVAL_MS`).
- A fila não deduplica. A idempotência fica com o consumidor (ADR 0006).
- Trocar por um broker real afeta só a `TableQueue`.
- A tabela cresce sem limite. A limpeza de mensagens antigas fica fora do escopo.
