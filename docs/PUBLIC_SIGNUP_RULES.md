# Cadastro Publico E Planos

Este documento registra os contratos que a tela publica precisa preservar. Ele existe para evitar que ajustes visuais alterem billing, licencas ou o fluxo do Launcher.

## Donos De Cada Parte

- `Merlin-public`: apresenta planos em `/download`, coleta dados e chama APIs publicas.
- `Merlin-admin`: configura feature flags e Price IDs; nao serve o site publico.
- `Merlin-api`: valida tier/preco, cria checkout Stripe ou Pix e cria/renova licencas.
- Launcher: aplica a ativacao local; nao decide preco, tier ou checkout.

## Tela De Planos

- A POC em `C:\Users\Usuario\Videos\merlin-planos` e somente referencia visual.
- Os cards pertencem a `/download`; nao criar pagina visual `/checkout`.
- Toda string nova da area de planos deve usar `t("...")` e estar no dicionario de `src/i18n.ts`.
- Os beneficios dos cards usam linguagem de produto (`Ativações Premium`). A tabela comparativa mostra as regras de limite e cooldown.
- Tooltips explicam regra sem transformar o card em texto tecnico: Bronze tem limite mensal, Prata mantem cooldown, Ouro limita somente a repeticao do mesmo jogo.

## Billing E Retorno

- O navegador envia apenas `planTier`, periodo e forma de pagamento; valores e Price IDs sao escolhidos e validados pela API.
- Cartao mensal/anual usa Stripe; Pix e manual quando configurado.
- O SDK de segurança do Mercado Pago usado no Pix precisa permanecer permitido na CSP (`https://www.mercadopago.com` em `script-src` e `https://api.mercadopago.com` em `connect-src`). As fontes Google usadas pelo design system também exigem `fonts.googleapis.com`/`fonts.gstatic.com` na CSP.
- Stripe retorna para `/download?checkout=success&session_id=...`. O retorno deve abrir o fluxo de `Meu acesso` enquanto o checkout é reconciliado e, quando a licença estiver disponível, fechar o modal e focar o painel `#resultado-acesso` que exibe a licença. Esse foco precisa acontecer depois da expansão visual do painel; não depender de um único scroll imediato.
- Reutilizacao de checkout deve considerar periodo, tier e eventual licenca de reativacao.
- Upgrade/downgrade publico permanece desligado ate existir a tela dedicada de `Meu acesso`.

## Ativacao Premium

Para ativações Premium, a ativacao e contabilizada quando `completePremiumActivation` conclui no backend. Bronze consome uma das tres ativacoes e o cooldown e aplicado nesse mesmo momento. Esta tela nao deve mover confirmacao para depois do Launcher nem introduzir rollback automatico.
