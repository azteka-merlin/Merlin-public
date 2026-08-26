# Meu acesso: cenarios reais de troca de plano

A identificacao por e-mail, PIN e codigo pertence ao fluxo existente de
`Consultar meu acesso`. Esta matriz vale somente depois de `access/me` retornar
uma licenca autenticada. A POC fornece a apresentacao visual, nunca valores,
regras ou resultados simulados.

| Cenario | Comportamento no Merlin | Contrato |
| --- | --- | --- |
| Bronze, Prata ou Ouro mensal/anual | Mostra plano, renovacao e preco reais | `access/me` + precos publicos |
| Upgrade de tier | Preview real; alteracao imediata abre Checkout hospedado Stripe | `plan-change/preview`, `plan-change` |
| Mensal para anual | A API decide se exige pagamento; quando exige, abre Stripe | preview real |
| Downgrade de tier | Agenda para o fim do periodo, sem checkout | `timing=period_end` |
| Anual para mensal | Agenda para o fim do periodo, sem checkout | `timing=period_end` |
| Tier e periodo juntos | Mostra o preview e segue o `timing` retornado | preview real |
| Pagamento pendente | Mostra apenas `Alteracao processando` | `planChange.pending_payment` |
| Pagamento nao concluido | Mostra estado alto nivel e permite nova tentativa | `planChange.not_completed` |
| Alteracao agendada | Mostra plano futuro e data efetiva | `planChange.scheduled` |
| Cancelar agendamento | Cancela somente a mudanca de plano | `plan-change/cancel` |
| Substituir agendamento | Confirma, cancela a mudanca atual e abre o seletor | cancelamento seguido de nova criacao |
| Portal Stripe | Abre em nova guia para cartao, faturas e cancelamento | `billing-portal` |
| Pix, vitalicio, teste e manual | Mantem leitura; nao inventa troca de plano | contrato atual |
| Flag de planos desligada | Mantem leitura; seletor fica indisponivel | `plansEnabled=false` |
| Erro de preview ou dado desatualizado | Mantem a licenca atual e retorna ao seletor com erro da API | resposta da API |

Nao sao desenhados no Merlin: recusas de cartao, CVV, 3DS, retry ou detalhes
tecnicos de cobranca. Quando necessario, esses fluxos acontecem na Stripe.
