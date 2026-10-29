# 0001. Arquitetura em camadas simplificada

- Status: Aceito
- Data: 2026-10-29

## Contexto

O serviço tem poucas regras de negócio, mas elas são críticas: quando uma nota é aprovada ou rejeitada, quais motivos são gravados e que status terminais não mudam mais. Essas regras precisam ser testáveis sem banco e sem framework.

Ao mesmo tempo, o serviço é pequeno e precisa ser fácil de explicar. Abstrações demais custam mais para ler do que entregam de valor.

## Opções avaliadas

1. **Clean Architecture completa.** Ports e adapters para tudo: unit of work, outbox, inbox, broker, relógio e gerador de id, cada um com interface e token de injeção. Isola bem as camadas, mas gera muitos arquivos e indireções para um serviço deste tamanho.
2. **Camadas simplificadas** (`domain` / `application` / `infra` / `main` / `shared`). O domínio é puro e define as interfaces de repositório. A aplicação orquestra os casos de uso. A infra implementa banco, fila e HTTP. O `main` faz a composição.
3. **Módulos NestJS por feature, sem camadas.** É o mais rápido de escrever, mas as regras de negócio ficam misturadas com SQL e controllers, e testá-las exige banco ou mocks do framework.

## Decisão

Opção 2: camadas simplificadas.

```
src/
├── domain/        entidades, value objects, erros e interfaces de repositório
├── application/   casos de uso e contratos das mensagens
├── infra/         banco, repositórios, mensageria e HTTP
├── main/          módulo Nest (composition root) e bootstrap
└── shared/        configuração (variáveis de ambiente validadas)
```

## Motivo

- As regras de aprovação e rejeição ficam em `Invoice.applyResult` e são testadas com testes unitários puros.
- A divisão é fácil de navegar e de explicar: cada pasta tem uma responsabilidade.
- Mantém o essencial da opção 1 (o domínio não depende de infraestrutura) sem as abstrações que este serviço não precisa: relógio e gerador de id intercambiáveis, uma porta por tabela.
- A opção 3 tornaria mais caro testar justamente o que mais importa.

## Consequências

- O domínio não importa NestJS, `pg` nem `zod`. A regra é garantida pelo ESLint (`no-restricted-imports`).
- As interfaces de repositório e de transação ficam em `domain/repositories`. As implementações em PostgreSQL ficam em `infra/repositories`.
- O NestJS aparece só em `application` (injeção de dependência), `infra` e `main`.
- O `app.module.ts` é o único lugar que liga as interfaces às implementações.
