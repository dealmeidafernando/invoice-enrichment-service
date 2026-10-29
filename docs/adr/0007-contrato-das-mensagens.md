# 0007. Contrato das mensagens

- Status: Aceito
- Data: 2026-10-29

## Contexto

O enunciado define o conteúdo das duas mensagens:

- **ida:** o id da nota e a chave de acesso;
- **volta:** a mesma chave, o CNPJ, o valor, a data de emissão e se a nota está cancelada.

Falta definir o formato: como identificar uma mensagem para deduplicar (ADR 0006), como evoluir o contrato, como representar dado ausente e o que fazer com uma mensagem mal formada.

## Opções avaliadas

**Formato:**

1. **Payload puro** (só os campos de negócio). É o mais simples, mas não tem identidade de mensagem para deduplicar nem versão para evoluir.
2. **Envelope** `{ messageId, type, version, occurredAt, correlationId, payload }`. A identidade, a versão e o rastreio ficam separados dos dados de negócio.

**Campo ausente na volta** (sem CNPJ, sem valor ou sem data):

- **(a) Erro de contrato:** a mensagem é descartada como inválida.
- **(b) Resultado válido:** o campo chega como `null` e a nota é rejeitada com o motivo.

**Mensagem mal formada** (tipo errado, data ilegível, versão desconhecida):

- **(i) Retentar** até esgotar as tentativas.
- **(ii) Não retentável:** vai direto para `DEAD`, sem mudar a nota.

## Decisão

Envelope (opção 2), campo ausente como `null` (b) e mensagem mal formada como não retentável (ii).

```jsonc
// ida: invoice.enrichment.requested
{ "invoiceId": "uuid", "accessKey": "44 dígitos" }

// volta: invoice.enrichment.completed
{
  "accessKey": "44 dígitos",
  "cnpj": "12345678000190" | null,       // 14 dígitos; pontuação é removida
  "amount": "1520.75" | null,            // decimal como string, até 2 casas
  "issueDate": "2026-10-01T12:00:00-03:00" | null,  // ISO 8601
  "canceled": false                      // obrigatório
}
```

## Motivo

- O `messageId` é o que permite deduplicar a reentrega (ADR 0006). O `version` permite mudar o contrato sem quebrar consumidores antigos. O `correlationId` liga a mensagem ao request de origem nos logs.
- O enunciado diz que um resultado "sem esses dados vai para REJEITADA e grava o motivo". Dado ausente é um **resultado de negócio**, não um erro técnico. Os motivos são `MISSING_CNPJ`, `MISSING_AMOUNT`, `MISSING_ISSUE_DATE` e `INVOICE_CANCELED`, e todos os encontrados são gravados.
- Retentar uma mensagem mal formada nunca dá certo. Mandar direto para `DEAD` evita gastar tentativas e preserva a mensagem para análise.
- `amount` como string evita a perda de precisão de ponto flutuante no JSON. No domínio, o valor é guardado em centavos (`bigint`) e, no banco, como `numeric(15,2)`.

## Consequências

- A validação da volta usa `zod` na camada de infra (`enrichment-completed.consumer.ts`) e converte os dados para os tipos do domínio (`AccessKey`, `Money`, `Date`).
- Strings vazias são tratadas como `null`.
- Uma mensagem em `DEAD` precisa de reprocessamento manual. Um comando de redrive fica fora do escopo.
