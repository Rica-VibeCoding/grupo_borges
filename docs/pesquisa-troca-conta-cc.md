# Pesquisa — trocar a conta CC da tropa pelo cockpit

> Estado: pesquisa concluída, implementação NÃO começada. Pausado 16/08 a pedido do Rica — retomar por aqui. `tropa_task` aponta pra este arquivo.

## Objetivo

Rica tem duas contas Anthropic (Woodpro e Ricardo). Quando uma bate no limite,
ele quer clicar num componente do cockpit (a pílula de conta no card de cota,
`apps/cockpit/components/shell/bloco-de-cota.tsx`, entregue em `783c3f6`/`4ddcd4a`)
e trocar a conta ativa **da tropa inteira de uma vez** — não por agente
individual. Hoje o card só EXIBE a conta, não troca.

## Pesquisa 1 (Canário, `/pesquisa`) — mecanismo nativo

- Login fica em `~/.claude/.credentials.json` (Linux, 0600) — campo `claudeAiOauth`
  com `accessToken`/`refreshToken`/`expiresAt`/`refreshTokenExpiresAt`/`scopes`/
  `subscriptionType`. `~/.claude.json` é só perfil (email/display), não credencial.
- Sem multi-conta nativo documentado. Só `/login` interativo (OAuth PKCE via
  browser) ou `claude setup-token` (token de 1 ano, pensado pra CI).
- Achado empírico real nesta máquina (commit `783c3f6`): um `/login` trocou a
  conta de duas sessões vivas simultaneamente, sem reiniciar nada — a conta é
  por MÁQUINA, não por processo/sessão.

## Pesquisa 2 (Canário, `/pesquisa`) — comunidade

- Issues abertas (#22992 device-code, #20131 multi-account, #27359 named
  profiles) sem resposta do time Anthropic — sem sinal de roadmap.
- Ecossistema de ferramentas de terceiros (`cc-accounts`, `ccpm`, `cchost`,
  `clauth`, `claude-revolver` etc.) isola conta via `CLAUDE_CODE_OAUTH_TOKEN` +
  `CLAUDE_CONFIG_DIR` — funciona, mas:
  - **restart obrigatório** — env só é lido no nascimento do processo, nenhuma
    ferramenta troca a quente;
  - **billing cruzado** — sem remover `oauthAccount` do `.claude.json`, as duas
    contas cobram a mesma assinatura;
  - sobrescrever `.credentials.json` só é feito pela comunidade com restart +
    backup, nunca em sessão viva — relato (não confirmado por fetch direto) de
    que a troca mata requisições em voo de TODAS as sessões da máquina.

## Pivô do Rica (16/08, voz) — simplifica o desenho

Rica não quer isolamento por agente — quer trocar a conta **da tropa inteira**
de uma vez, do jeito que ele já faz manualmente no terminal (`/login` de novo).
Isso elimina o problema de billing cruzado (só uma conta ativa por vez, como já
é hoje) e o isolamento por `CLAUDE_CONFIG_DIR` por sessão.

## Correção técnica (doc oficial, lida 16/08)

`claude setup-token` abre o MESMO fluxo de browser do `/login`; o token final
é só IMPRESSO no terminal, não salva em arquivo nenhum sozinho. Como variável
de ambiente (`CLAUDE_CODE_OAUTH_TOKEN`), só é lido no nascimento da sessão —
**não** propaga pra sessões já rodando. Pra ter o efeito "os outros agentes
pegam sozinhos" (que já observamos acontecer com `.credentials.json`), o token
precisaria ser escrito DENTRO do arquivo de credencial, não como variável —
**isso ainda não foi testado/confirmado**. Formato exato de como o
`setup-token` se encaixa nos campos `accessToken`/`refreshToken` do arquivo é
desconhecido.

## Tentativa de teste (16/08) — travou no fluxo OAuth

Ambiente de teste isolado criado (`CLAUDE_CONFIG_DIR` separado, fora do
`~/.claude` real). Rica rodou `claude setup-token` duas vezes (Woodpro,
Ricardo), mas em ambas colou pra mim o **código intermediário do callback OAuth**
(formato `código#state`), não o token final — a "gaveta" da CLI fechou sem
mostrar o token impresso. Testei os dois valores isolado: **401 Invalid bearer
token** nas duas contas, confirmando que não são tokens válidos.

**Retomar por aqui:** Rica precisa rodar `claude setup-token` de novo, dessa
vez redirecionando a saída pra um arquivo (`tee` ou similar) pra garantir que
capturamos o token final mesmo que a UI feche rápido. Sem isso, a hipótese
central (escrever no `.credentials.json` funciona sem restart) segue sem
validar.

## Achado lateral (não bloqueia isto, registrado à parte)

Durante o teste, uma mensagem de voz do Rica no Telegram se perdeu durante um
`/reload-plugins`. Causa raiz encontrada no código do plugin oficial + doc do
grammy (Context7): o `shutdown()` do plugin (`server.ts`, ~linha 658) dá só 2s
pro `bot.stop()` terminar antes de forçar `process.exit(0)`; o grammy só
garante zero perda em long polling se o bot parar "corretamente" (offset
sincronizado). Bug de desenho do plugin oficial, não nosso. Não gerou
`tropa_task` própria ainda — avaliar se vale reportar upstream.

## Próximos passos (nesta ordem)

1. Rica gera os dois `setup-token` de novo, capturando a saída em arquivo.
2. Testar no ambiente isolado (`CLAUDE_CONFIG_DIR` de teste) se o token
   funciona como `CLAUDE_CODE_OAUTH_TOKEN` (prova que o token em si é válido).
3. Testar se escrever esse token dentro de um `.credentials.json` sintético
   (no formato achado pela pesquisa 1) é aceito pelo CC — hipótese ainda não
   validada, pode não ser tecnicamente viável.
4. Só depois de 2 e 3 provados: desenhar o botão no cockpit (endpoint que
   troca o arquivo compartilhado + confirma qual conta ficou ativa).

## Dificuldade estimada

2 (mecânica crua, se a escrita direta no arquivo funcionar) a 3 (se precisar
de um caminho intermediário mais elaborado). Não muda pra cima com o pivô
fleet-wide — só pra baixo, por eliminar o isolamento por sessão.
