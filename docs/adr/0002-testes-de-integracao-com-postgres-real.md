# 0002. Testes de integração com PostgreSQL real

- Status: Aceito
- Data: 2026-10-29

## Contexto

As regras mais delicadas do serviço não estão só no código, estão no banco:

- a mesma chave não pode gerar duas notas, nem com requisições simultâneas;
- a mesma mensagem de volta, entregue de novo, não pode mudar a nota outra vez;
- uma falha no meio do processamento não pode deixar estado pela metade.

Elas dependem de constraints, transações, locks (`FOR UPDATE`) e `SKIP LOCKED`. Um teste que não exercita isso não prova a regra.

## Opções avaliadas

1. **Repositórios em memória e mocks.** São rápidos e não precisam de infraestrutura, mas não reproduzem concorrência, constraints nem rollback. O teste passaria com um código que falha em produção.
2. **Testcontainers.** Usa PostgreSQL real, isolado por execução. Em troca, acrescenta uma dependência, deixa o boot mais lento e exige acesso ao Docker de dentro do processo de teste.
3. **PostgreSQL real do `docker compose`**, com um banco separado (`invoices_test`) criado pelo script de init.

## Decisão

Opção 3, junto com testes unitários puros para as regras do domínio.

## Motivo

- O que precisa ser provado (unicidade sob concorrência, reentrega, rollback) só existe num banco real.
- O compose já é exigido pela entrega, então não há nada novo para subir.
- O banco `invoices_test` separado garante que os testes nunca apagam os dados da demo.
- As regras de aprovação e rejeição continuam testadas sem banco (`test/unit`). Os testes de integração ficam para o que depende do banco.

## Consequências

- Os testes de integração precisam de `docker compose up -d postgres` e de `DATABASE_URL_TEST`.
- Eles rodam em série (`maxWorkers: 1`) e limpam as tabelas antes de cada teste.
- As migrations são aplicadas uma vez, no `globalSetup` do Jest.
- No CI, o mesmo PostgreSQL sobe como service do GitHub Actions.
