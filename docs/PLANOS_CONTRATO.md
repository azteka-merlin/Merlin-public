# Contrato dos planos públicos

O cadastro público somente exibe Bronze, Prata e Ouro quando `plansEnabled` está ativo em `/api/billing/settings-public`.

- Cartão: o Price ID é configurado no admin por tier e período e deve ser recorrente mensal ou anual.
- Pix: o valor é configurado no admin por tier e período; Price ID é opcional e não é a fonte de cobrança do Mercado Pago.
- Com tiers ativos, novas vendas vitalícias são bloqueadas. Licenças vitalícias existentes continuam válidas.
- Compras públicas enviam `planTier` e `planType` para cartão e Pix.
- O Customer Portal Stripe gerencia cancelamento, reversão de cancelamento, fatura e cartão. Troca de tier não pertence ao Portal.
- Quando uma alteração de plano exigir pagamento por cartão, o Merlin apresenta o preview e redireciona para uma experiência hospedada pela Stripe. O Merlin só reflete o retorno de alto nível: processando, concluída ou não concluída.
- A futura tela "Meu acesso" consumirá os contratos de troca de plano. Ela não deve reintroduzir checkout ou regras de billing no front.

## Regras Premium

| Tier | Ativações Premium | Cooldown | Novos lançamentos |
| --- | --- | --- | --- |
| Bronze | 3 por mês | 24h global | até 7 dias |
| Prata | ilimitadas | 24h global | até 5 dias |
| Ouro | ilimitadas | 24h por jogo | até 48h |

Para ativações Premium, a ativação é contabilizada quando `completePremiumActivation` conclui no backend. Falhas locais posteriores do Launcher seguem o contrato existente e não criam rollback automático.
