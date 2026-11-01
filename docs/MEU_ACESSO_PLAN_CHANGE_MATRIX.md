# Meu acesso: cenarios reais de troca de plano

A identificacao por e-mail, PIN e codigo pertence ao fluxo existente de
`Consultar meu acesso`. Esta matriz vale somente depois de `access/me` ou `access/session` retornar
uma licenca autenticada. A POC fornece a apresentacao visual, nunca valores,
regras ou resultados simulados.

| Cenario | Comportamento no Merlin | Contrato |
| --- | --- | --- |
| Bronze, Prata ou Ouro mensal/semestral/anual | Mostra plano, renovacao e preco reais | acesso autenticado + precos publicos |
| Upgrade de tier | Preview real; alteracao imediata abre Checkout hospedado Stripe | `plan-change/preview`, `plan-change` |
| Mensal para semestral/anual ou semestral para anual | A API decide se exige pagamento; quando exige, abre Stripe | preview real |
| Downgrade de tier | Agenda para o fim do periodo, sem checkout | `timing=period_end` |
| Anual para semestral/mensal ou semestral para mensal | Agenda para o fim do periodo, mesmo junto de upgrade de tier | `timing=period_end` |
| Tier e periodo juntos | Mostra o preview e segue o `timing` retornado | preview real |
| Pagamento pendente | Mostra apenas `Alteracao processando` | `planChange.pending_payment` |
| Pagamento nao concluido | Mostra estado alto nivel e permite nova tentativa | `planChange.not_completed` |
| Alteracao agendada | Mostra plano futuro e data efetiva | `planChange.scheduled` |
| Cancelar agendamento | Cancela somente a mudanca de plano | `plan-change/cancel` |
| Substituir agendamento | Confirma, cancela a mudanca atual e abre o seletor | cancelamento seguido de nova criacao |
| Portal Stripe | Abre em nova guia para cartao, faturas e cancelamento | `billing-portal` |
| Pix ativo, upgrade de tier no mesmo periodo | Preview real com diferenca proporcional; na confirmacao, aplica o tier e preserva o vencimento | `access/session/pix-plan-transition/preview` e `access/session/pix-plan-transition` |
| Pix ativo, periodo mais longo | Preview real com credito Pix nao usado, inclusive se o tier escolhido for menor; na confirmacao, inicia o novo periodo | mesmo contrato de transicao Pix |
| Pix ativo para cartao | Checkout Stripe hospedado; troca apenas de metodo preserva vencimento, upgrade usa credito Pix. Primeira migracao exige mais de 24h30 restantes | mesmo contrato de transicao Pix |
| Pix ativo, tier inferior sem alongamento ou periodo menor fora dos ultimos sete dias | Informa que a troca ainda nao esta disponivel | preview da API |
| Pix nos ultimos sete dias, tier inferior sem alongamento ou periodo menor | Paga antecipadamente o periodo seguinte; plano atual fica ate o vencimento | transicao Pix ou `access/session/renewal/pix` conforme o fluxo |
| Pix vencido | Escolhe tier/periodo e reativa a mesma chave na confirmacao | transicao Pix ou `access/session/renewal/pix` conforme o fluxo |
| Vitalicio, teste e manual nao Pix | Mantem leitura; nao inventa troca de plano | contrato atual |
| Flag de planos desligada | Mantem leitura; seletor fica indisponivel | `plansEnabled=false` |
| Erro de preview ou dado desatualizado | Mantem a licenca atual e retorna ao seletor com erro da API | resposta da API |

Nao sao desenhados no Merlin: recusas de cartao, CVV, 3DS, retry ou detalhes
tecnicos de cobranca. Quando necessario, esses fluxos acontecem na Stripe.
