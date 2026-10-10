# Contrato dos planos públicos

O cadastro público somente exibe Bronze, Prata e Ouro quando `plansEnabled` está ativo em `/api/billing/settings-public`.

- Cartão: o Price ID é configurado no admin por tier e período: mensal (`month/1`), semestral (`month/6`) ou anual (`year/1`). A API valida também o `interval_count`; um preço mensal não pode ser usado como semestral.
- Pix: o valor é configurado no admin por tier e período; Price ID é opcional e não é a fonte de cobrança do Mercado Pago.
- Com tiers ativos, novas vendas vitalícias são bloqueadas. Licenças vitalícias existentes continuam válidas.
- Compras públicas enviam `planTier` e `planType` para cartão e Pix.
- O Customer Portal Stripe gerencia cancelamento, reversão de cancelamento, fatura e cartão. Troca de tier não pertence ao Portal.
- Quando uma alteração de plano exigir pagamento por cartão, o Merlin apresenta o preview e redireciona para uma experiência hospedada pela Stripe. O Merlin só reflete o retorno de alto nível: processando, concluída ou não concluída.
- A tela `/meu-acesso` já consome os contratos de troca de plano por sessão autenticada e CSRF. O acesso pela modal em `/download` continua usando a autenticação existente; a renovação Pix reutiliza a mesma rota protegida de renovação.
- Semestral e anual exibem o total do período, a economia Pix em relação ao cartão e a alternativa de cartão quando ambos estão disponíveis. O equivalente mensal é apenas uma apresentação; nunca o valor enviado ao provedor.
- Períodos desabilitados e preços inativos não podem ser escolhidos. Semestral é exclusivo da estrutura de tiers e fica desabilitado por padrão até configuração explícita.

## Regras Premium

| Tier | Ativações Premium | Cooldown | Novos lançamentos |
| --- | --- | --- | --- |
| Bronze | 3 por mês | 24h global | até 7 dias |
| Prata | ilimitadas | 24h global | até 5 dias |
| Ouro | ilimitadas | 24h por jogo | até 48h |

Para ativações Premium, a ativação é contabilizada quando `completePremiumActivation` conclui no backend. Falhas locais posteriores do Launcher seguem o contrato existente e não criam rollback automático.
