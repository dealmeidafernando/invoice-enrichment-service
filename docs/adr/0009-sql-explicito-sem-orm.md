# 0009. Acesso a dados com SQL explícito (`pg`) em vez de ORM

- Status: Aceito
- Data: 2026-10-29

## Contexto

As regras mais importantes do enunciado não são garantidas pelo código da aplicação, e sim por recursos específicos do PostgreSQL:

| Regra                                                | Recurso do PostgreSQL                             | ADR        |
| ---------------------------------------------------- | ------------------------------------------------- | ---------- |
| A mesma chave não gera duas notas, mesmo em paralelo | `UNIQUE` + `INSERT ... ON CONFLICT DO NOTHING`    | 0005       |
| A mesma mensagem de volta não muda a nota de novo    | inbox com `ON CONFLICT` + `SELECT ... FOR UPDATE` | 0006       |
| Nota decidida não muda                               | `UPDATE ... WHERE status = 'ANALISE'`             | 0006       |
| Dois consumidores não pegam a mesma mensagem         | `FOR UPDATE SKIP LOCKED`                          | 0003, 0004 |
| Nota e mensagem de ida gravadas juntas               | transação única (`BEGIN`/`COMMIT`)                | 0004       |
| Réplicas não rodam migração em paralelo              | `pg_advisory_lock`                                | 0008       |

O schema é pequeno: quatro tabelas (`invoices`, `outbox`, `queue_messages`, `processed_messages`). O domínio não pode depender de infraestrutura (ADR 0001).

## Opções avaliadas

1. **TypeORM.** É o padrão mais comum com NestJS e tem integração pronta. Em troca, as entidades com decorators (`@Entity`, `@Column`) misturam persistência no domínio, ou exigem um segundo modelo com mapeamento manual de qualquer jeito. `ON CONFLICT ... RETURNING`, `SKIP LOCKED` e o `UPDATE` condicional acabam em QueryBuilder ou em `query()` cru.
2. **Prisma.** Tem tipagem forte gerada a partir do schema. Não expressa `FOR UPDATE SKIP LOCKED` nem lock de linha na API própria, e esses casos caem em `$queryRaw`. Acrescenta um passo de geração de código e um schema paralelo às migrações.
3. **Kysely (query builder tipado).** Tipa as colunas e continua expressando todo o SQL necessário. É uma boa opção, mas exige manter os tipos das tabelas em sincronia e acrescenta uma dependência que, com quatro tabelas, ainda não se paga.
4. **`pg` com SQL explícito.** Cada repositório escreve a query exata e mapeia a linha para a entidade do domínio. Uma classe `Database` pequena centraliza `query()` e as transações.

## Decisão

Opção 4: driver `pg` com SQL explícito nos repositórios e migrações em arquivos `.sql`.

- `Database.query()` executa na transação corrente, se houver, ou no pool.
- `Database.run()` abre a transação e a propaga por `AsyncLocalStorage`. Nota, outbox e inbox caem no mesmo `BEGIN`/`COMMIT` sem que o repositório receba um client.
- Cada repositório converte a linha em entidade (`Invoice.restore(...)`). O domínio não importa nada de `pg`.

## Motivo

- **A garantia fica visível.** Quem revisa `pg-invoice.repository.ts` lê o `ON CONFLICT` e o `WHERE status = 'ANALISE'` que impedem a duplicidade e a sobrescrita. Com um ORM, esse comportamento ficaria escondido atrás de um método ou num trecho de SQL cru do mesmo jeito.
- **Um ORM não tiraria o SQL do caminho.** As operações críticas precisariam de query crua em qualquer uma das opções 1 e 2. O ORM entraria como camada extra sem resolver o problema principal.
- **O domínio continua puro.** A entidade `Invoice` não tem decorators nem conhece o banco, e o mapeamento fica num único lugar.
- **O tamanho não justifica a abstração.** São quatro tabelas e poucas queries.
- **As migrações são SQL puro.** `UNIQUE`, `CHECK` (`ck_invoices_approval`, `ck_invoices_rejection_reason`) e índices ficam explícitos e revisáveis.

## Consequências

- O mapeamento linha → entidade é manual em cada repositório.
- As queries não são tipadas em tempo de compilação: um nome de coluna errado só aparece em execução. Os testes de integração contra PostgreSQL real (ADR 0002) passam por todas as queries e pegam esse tipo de erro.
- Se o schema crescer, o código repetitivo de mapeamento cresce junto. O próximo passo seria adotar **Kysely** (opção 3) para tipar as queries sem esconder o SQL, antes de considerar um ORM.
