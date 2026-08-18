# Pesquisa — trocar a conta CC da tropa pelo cockpit

> Estado: mecanismo PROVADO em 18/08, implementação NÃO começada. `tropa_task` aponta pra este arquivo.

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

**Resolvido em 18/08 (Pavan).** O `tee` não era o problema — o que quebrava era
o processo do `setup-token` morrer do lado de quem aprova. Receita que funcionou:
rodar o comando numa tmux nossa com `CLAUDE_CONFIG_DIR` isolado, mandar só a URL
pro Rica, e colar o código que ele devolve no pane **VIVO** por `send-keys`.
Token da conta WOODPRO em `~/.claude/secrets/cc-oauth-token-woodpro-2026-08-18.txt`
(chmod 600, 1 ano). Os dois arquivos de 16/08 estão renomeados pra
`.INVALIDO-codigo-intermediario`.

## Hipótese central VALIDADA (18/08, Daniel)

O passo 3 da lista abaixo era o risco real do projeto — e passou:

- `.credentials.json` sintético num `CLAUDE_CONFIG_DIR` isolado, com o token
  `sk-ant-oat01-…` no campo `accessToken`, `refreshToken` vazio, `expiresAt` a
  360 dias, `scopes: ["user:inference"]` → `claude -p` autenticou e respondeu.
- **Controle negativo:** com os 8 últimos caracteres do token trocados por
  `XXXXXXXX`, o mesmo comando deu `401 OAuth access token is invalid`. É isso que
  prova que a autenticação veio do arquivo, e não de um fallback silencioso.
- Scope reduzido não quebrou visão: o mesmo `claude -p` leu uma imagem local e
  descreveu.
- Identidade do token confirmada por fora do que o Pavan afirmou: header
  `anthropic-organization-id` = `a7ce47e0-…` = Max woodpromais.

**Estado das contas no dia do teste:** a frota rodava em `ricardo.incasa@gmail.com`
(org `60094366-…`, via `/api/oauth/profile`) — atenção, o `subscriptionType` do
arquivo dizia `"max"` e levaria à conta errada. A WOODPRO, conta de destino da
troca, estava com `7d-utilization` em **0,81**.

### O que continua NÃO medido

1. ~~**Sessão viva migra?**~~ **Deixou de ser requisito em 18/08.** O Rica decidiu
   (voz) que dá o restart na mão, agente por agente: quem ele não reinicia continua
   na chave antiga, quem ele reinicia vem pra nova — e ele quer justamente esse
   controle. O botão não precisa orquestrar restart nem garantir migração a quente.
2. **MCP sob scope reduzido.** O `setup-token` entrega só `user:inference`; o
   login normal traz 5 scopes, incluindo `user:mcp_servers` e `user:file_upload`.
   Se algum agente perder MCP depois da troca, a causa é essa.
3. **`refreshToken` vazio** — não há renovação automática; vale o prazo do token.

## Achado lateral (não bloqueia isto, registrado à parte)

Durante o teste, uma mensagem de voz do Rica no Telegram se perdeu durante um
`/reload-plugins`. Causa raiz encontrada no código do plugin oficial + doc do
grammy (Context7): o `shutdown()` do plugin (`server.ts`, ~linha 658) dá só 2s
pro `bot.stop()` terminar antes de forçar `process.exit(0)`; o grammy só
garante zero perda em long polling se o bot parar "corretamente" (offset
sincronizado). Bug de desenho do plugin oficial, não nosso. Não gerou
`tropa_task` própria ainda — avaliar se vale reportar upstream.

## Próximos passos (nesta ordem)

1. ~~Gerar o `setup-token` capturando a saída.~~ ✅ 18/08 — WOODPRO.
2. ~~Provar que o token é válido isolado.~~ ✅ 18/08.
3. ~~Provar que o token escrito dentro do `.credentials.json` é aceito.~~ ✅ 18/08,
   com controle negativo.
4. **Aberto — autorizado pelo Rica em 18/08; chave pedida ao Pavan.** Gerar o
   token da segunda conta (`ricardo.incasa`) pela mesma receita, e então desenhar o endpoint que reescreve
   o `.credentials.json` compartilhado (backup antes, confirmação de qual conta
   ficou ativa por `/api/oauth/profile` depois). A pílula de conta em
   `apps/cockpit/components/shell/bloco-de-cota.tsx` vira o gatilho.
5. ~~Medir se as sessões vivas migram sozinhas.~~ Fora de escopo por decisão do
   Rica (18/08) — o restart é manual e escalonado, por vontade dele. A dificuldade
   fica em 2.

## Dificuldade estimada

2 (mecânica crua, se a escrita direta no arquivo funcionar) a 3 (se precisar
de um caminho intermediário mais elaborado). Não muda pra cima com o pivô
fleet-wide — só pra baixo, por eliminar o isolamento por sessão.
