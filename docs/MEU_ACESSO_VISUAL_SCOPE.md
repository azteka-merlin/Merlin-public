# Meu Acesso: Escopo Visual

## Motivo deste documento

Houve uma tentativa incorreta de refatorar `Meu acesso` que substituiu etapas funcionais do modal, ampliou a interface para uma tela inteira e reutilizou componentes da POC sem respeitar o contêiner real. Isso causou regressões no fluxo de e-mail/PIN/código e uma interface comprimida, diferente da referência aprovada.

Este documento evita que esse erro se repita.

## Limite de escopo

Uma task visual de `Meu acesso` pode alterar somente a apresentação do estado de detalhes depois da autenticação bem-sucedida.

Não alterar nestas tasks:

- cadastro público e layout de `/download`;
- checkout de novos usuários;
- cards públicos de planos;
- i18n existente;
- API, Stripe, Pix, admin, Launcher ou migrations;
- CSS global para compensar problemas da modal.

## Fluxo que deve ser preservado

Antes dos detalhes, manter exatamente o comportamento original do `AccessModal`:

- e-mail;
- PIN de recuperação;
- envio do código;
- seis campos do código de verificação;
- reenvio do código;
- troca de e-mail;
- mensagens, validações e estados de carregamento existentes.

Não criar uma segunda tela ou componente de autenticação para `Meu acesso`.

## Uso da POC

As referências em `src/poc/MeuAcessoPoc.tsx` e `src/poc/accessScenarios.ts` definem apenas o visual dos detalhes autenticados:

- hierarquia visual;
- espaçamentos;
- tipografia;
- cards;
- ícones;
- responsividade;
- estados de alto nível.

Não copiar dados mockados, estados internos, regras comerciais ou fluxos de pagamento da POC.

`Meu acesso` continua como uma modal sobre `/download`: o fundo da página pública permanece intacto. No desktop, a modal deve comportar a grade de duas colunas da POC sem sobreposição. No mobile, os cards devem empilhar sem overflow horizontal.

## Procedimento obrigatório

1. Antes de editar, comparar o `AccessModal` atual com a versão anterior no Git e listar os trechos específicos a restaurar ou alterar.
2. Preservar mudanças do usuário e de outras tasks; nunca usar `git reset --hard`.
3. Implementar somente o bloco autenticado de detalhes, reutilizando callbacks e contratos já existentes.
4. Comparar visualmente a POC e a modal real em desktop e mobile.
5. Verificar ausência de texto sobreposto, preços cortados ou cards comprimidos.
6. Rodar `npm run build` em `Merlin-public`.
7. Mostrar `git diff --stat` e confirmar que os arquivos alterados pertencem apenas a `Meu acesso`.
8. Publicar somente em staging após a validação. Produção nunca é alterada sem pedido explícito.
