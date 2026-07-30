# Fusão — arquitetura do Cockpit v2

> Juiz: Pavan. Opinantes: `sol` (cold read, sem ver o playbook) e `kimi` (crítica adversarial, com o playbook na mão).
> Insumo extra: verificação de código do `assistant-ui` 0.15.1 / core 0.3.1 feita sob encomenda para desempatar.
> Data: 2026-07-30.

## Consenso — os dois chegaram sozinhos, de pontos de partida opostos

Isto tem peso especial: um opinante nunca viu o plano, o outro veio para atacá-lo, e ainda assim convergiram em seis pontos. Trato como decidido.

1. **Artefato de contrato ANTES de abrir qualquer frente paralela.** O sol chama de "kit de integração + vertical slice de referência"; o kimi lista os arquivos (`STACK.md`, `TOKENS.md` + `globals.css` congelado, `DATA-CONTRACT.md`, `OWNERSHIP.md`, checklist de equivalência). Mesma exigência.
2. **Ownership por caminho de arquivo, não por conceito.** Os dois insistem; o kimi mostra por que o recorte conceitual falha — o botão de push-to-talk mora *dentro* do composer, então "voz" e "chat" colidem fisicamente.
3. **Um `git worktree` por construtor**, com integração em janelas revisadas em vez de todos no mesmo índice.
4. **Gate objetivo, numérico, escrito antes** de virar a chave. Comparação visual pode aprovar, mas não decide.
5. **Celular = uma superfície por vez.** Três colunas simultâneas não existem no telefone; a gaveta vira bottom sheet ou rota.
6. **Desconfiança da biblioteca de chat.** O sol diz para não adotar; o kimi diz para provar em um dia ou cair para o plano B. Nenhum dos dois aceita adotar por leitura de documentação.

## A divergência principal e como eu decido

**Assunto:** adotar `assistant-ui` como esqueleto do chat (o que o playbook decidiu) ou construir a camada de mensagens sob controle próprio.

- **sol:** camada própria. O chat não é `user/assistant` — é fluxo de texto, raciocínio, tool call, resultado e diff; a biblioteca impõe a abstração errada e obriga a deformar as 3.100 linhas maduras. Sete critérios eliminatórios.
- **kimi:** shadcn-only. Três cenários de arrependimento, sendo o terceiro o que me fez parar: **os construtores são LLMs.** Todo executor conhece shadcn, Radix e Tailwind de cor — está no corpus. O `assistant-ui` 0.15.1 tem **um dia** de idade: os agentes vão alucinar a API com confiança, e eu passo a obra revisando invenção em vez de integrar. Pin de versão não corrige alucinação de modelo.
- **verificação de código:** os dois critérios técnicos mais duros do sol **passam**. A atualização é granular de verdade (WeakMap chaveado pela identidade do nosso objeto, lista assinando só `length`, memo por item, bail-out por `Object.is`) — é mais granular que uma lista React ingênua. A virtualização não vem montada, mas tem guia oficial e exemplo rodável em `@tanstack/react-virtual` com React 19 / Next 16 / Tailwind 4. E o plano de fuga funciona: `diff-viewer`, `tool-group` e `tool-fallback` colam puros, `reasoning` custa uma linha, só `markdown-text` não cola.

**Decisão: spike de um dia com gate objetivo, antes de qualquer frente abrir.** Não descarto pela opinião de dois modelos quando a leitura do código contradiz a premissa técnica deles; e não adoto por leitura de documentação quando um dos argumentos contrários não é técnico e sim de processo — e o risco de processo é real, porque quem vai escrever o código são LLMs que não têm essa biblioteca no treino.

O spike é o desempate honesto: SSE real → store coalescido → thread da biblioteca, medido **no celular do Rica**. Passou, fica. Falhou, cai para shadcn-only sobre o `render-items.ts` (528 linhas que já sabem linearizar payload do CC — o ativo real), minerando `ai-elements`/`prompt-kit` só como referência visual.

O argumento da alucinação tem uma mitigação que nenhum dos dois considerou: o `thread.tsx` é **arquivo nosso** depois do scaffold. Se o executor não conhece a API, ele lê o arquivo no repo, não a documentação de cabeça. O que exige regra: **o scaffold do chat é feito por mim, sequencialmente, e os executores editam arquivo existente em vez de escrever integração nova.**

## Furos do playbook que eu aceito e vou corrigir

O kimi achou uma contradição interna que eu não tinha visto, e ela é real:

- **"lib/ sobrevive com zero reescrita" × o critério de aceite.** O hotspot 10 mora em `use-messages-stream.ts:316` — que é `lib/`. E a contramedida do hotspot 1 (coalescer chunk por frame) mora na fronteira SSE→store, também em `lib/`. Ou a lib é intocável, ou o débito é resolvido. Não os dois. → Escrever a lista curta de cirurgias permitidas em `lib/` e admiti-las como escopo.
- **"lib/ importado, não copiado" × "apps/web não recebe commit".** O primeiro bugfix na lógica de stream quebra uma das duas regras, e import cruzado entre dois apps Next traz alias resolvendo contra tsconfig errado e risco de React duplicado. → Extrair `packages/cockpit-core` como pacote de workspace, com tsconfig próprio. Meio dia agora contra semanas de gambiarra de build.
- **O nome `web2` vira fóssil** — batizar `apps/cockpit` agora, enquanto renomear é grátis.
- **A stack não está registrada como decisão** (Next 16 / React 19 / Tailwind 4), embora a seção 6 exija sintaxe de Tailwind 4. Decisão não escrita vira três versões diferentes em três worktrees.
- **"Resolvido por construção" não é critério** — falta o número.
- **Paralelismo sem orçamento de máquina.** Três `next dev` com Turbopack (1–2 GB cada) + FastAPI + cockpit atual + a frota, numa VPS de 8 GB que **travou por memória hoje mesmo**. Este furo é o mais concreto de todos, e a validação empírica veio no mesmo dia: o gatilho do travamento foi fan-out de agentes em paralelo dentro de um scope só. → Regra escrita de quantos dev servers simultâneos, onde o build roda e com que limite de workers.
- **"Prova real com Márcio e Andy" é perigosa como está escrita** — o envio cai por `send-keys` na sessão real deles, no meio de trabalho produtivo. → Agente-canário, nunca sessão viva.
- **O fix do `stt-openai.sh` toca artefato compartilhado com a frota** — janela combinada, não no bolo do app novo.
- **Paradoxo do mockup.** "Aprovado antes de existir uma linha de Next" é incoerente: se é navegável e fiel de medida, já é o stack real; se é HTML estático, aprova aparência sem aprovar comportamento. → Redefinir: mockup = fatia vertical no stack real, em branch descartável.

## O furo mais grave: o plano é desktop e o usuário é celular

Aceito integralmente e promovo a risco número um. Não estavam no playbook: `safe-area` (composer colado no indicador do iPhone), teclado do iOS redimensionando o viewport e quebrando o stick-to-bottom, `100vh` × `dvh`, zoom automático em input com fonte menor que 16px, e retomada do SSE ao desbloquear a tela — hoje o cockpit fica congelado em silêncio e nada reconecta. E as medidas da seção 6 são as do ChatGPT **desktop**: composer de 768px não existe no telefone.

Somo o que o sol trouxe na mesma direção: manter montada só a conversa ativa e uma única conexão SSE, reduzir overscan, evitar blur e sombra caros, carregar kanban/voz/diff/highlighter sob demanda, e medir em celular mediano real — benchmark em notebook não serve como gate.

E uma verificação que dá para fazer antes de escrever qualquer código: **dois `EventSource` mais os fetches de API contra o teto de ~6 conexões HTTP/1.1 por host do Safari.** Se o `tailscale serve` não negociar HTTP/2, a lista não carrega quando o chat está aberto — e isso viraria um bug misterioso caçado por dias.

> ✅ **Verificado em 30/07 (Pavan).** `curl` contra `srv1061129.tailfe77db.ts.net` responde
> `http_version: 2` com status 200 nas **duas** portas — 3443 (painel antigo) e 3444 (v2).
> Com HTTP/2 há multiplexação numa conexão só, então o teto de ~6 por host não se aplica e
> o risco não se materializa. Vale enquanto o acesso for por `tailscale serve`: se algum dia
> a rota sair por outro proxy, refazer esta medição antes de assumir que continua valendo.

## O que entra que ninguém do plano tinha

Do sol:
- **Instrumentar o painel ANTIGO primeiro**, para ter baseline. Sem baseline, "melhor" é opinião.
- **Congelar transcripts reais como contrato de paridade** — incluindo reconexão, tool calls consecutivas, diffs grandes, mensagens parciais, erros e interrupções. O classificador tratado como caixa-preta: antigo e novo têm de produzir o mesmo modelo para os mesmos eventos.
- **Quatro camadas** com fronteira explícita: transporte / store de eventos / classificador / renderer. O renderer não conhece SSE, FastAPI nem tmux.
- Não colocar o fluxo inteiro num Context grande — store com subscription por item.

Do kimi:
- **Seleção de agente na URL (`/agente/[slug]`)**, não em context: deep-link a partir das notificações do Telegram, refresh que não perde o lugar, e o botão voltar do Android saindo do chat em vez de fechar o app. O `selected-agent-context.tsx` sobrevive como adaptador fino da rota.
- **A gaveta não é um segundo `sidebar` do shadcn** — dois `SidebarProvider` dividem o atalho `cmd+B` e disparam juntos, e o componente tem forma de navegação enquanto o inspetor é telemetria. Usar `aside` próprio, com painel ativo em search param (`?painel=contexto`) para o voltar do celular fechar a gaveta de graça.
- **Por que o chat não re-renderiza quando a gaveta abre:** stream em provider dentro da coluna do chat chaveado por slug, gaveta consumindo contextos separados e montando só o painel aberto, e mudança de largura em **CSS puro** — a escada de container query reage porque o `@container` é a coluna, não o viewport.
- **A matriz payload-do-CC → componente é o grosso do trabalho do chat** e não estava no plano: TodoWrite, AskUserQuestion, ExitPlanMode, imagem em tool_result, diff de Edit. São 409 linhas de casos no classificador.
- **Web Push / PWA** — já temos HTTPS e hostname. O evento que justifica: agente esperando permissão.
- **i18n** — as strings do assistant-ui nascem em inglês.
- **Fila de envio visível**, error reporting cliente→API, estados vazios dos 49 endpoints, confirmação em ação destrutiva com alvo de toque grande, rascunho do composer por agente, redirecionamento dos links antigos na virada, idle timeout do modo voz, e verificar **antes** se a conta OpenAI da frota tem acesso ao Realtime e aos modelos citados.
- **Rede mínima de teste:** `convertMessage` e o coalescedor são funções puras — teste unitário nelas pega a maior parte do drift entre frentes; mais um smoke de ponta a ponta como portão da equivalência.

## Descartado, com o motivo

- **Descartar o `assistant-ui` agora** (posição do sol, e do kimi na forma forte). Motivo: a leitura do código contradiz a premissa técnica — a biblioteca é mais granular que uma lista ingênua, tem caminho oficial de virtualização e plano de fuga em 3 de 5 componentes. Vira spike com gate, não descarte.
- **`MemoryMax` por sessão** (proposto na frente de infra do mesmo dia). Motivo: o OOM killer escolhe o maior processo do cgroup, que numa sessão com contexto grande pode ser o próprio `claude` — trocaria throttle temporário por perda de sessão.
- **Clonar um app de chat inteiro como base.** Motivo já no playbook: licença (Open WebUI trava branding acima de 50 usuários; LobeHub exige licença comercial para derivada) e, no caso do LibreChat, layout de 2023.
- **WebSocket de áudio passando pela VPS.** Motivo: mais código e repasse contínuo de frames pela máquina que já sofre.

## Comportamento observável

O gate traduz desta seção. Cada item é verificável de fora, sem olhar código.

1. **Streaming não engasga:** com 50 chunks por segundo durante 60 segundos e histórico de 1.000 mensagens, o scroll permanece estável e a digitação no composer não atrasa o eco do caractere — medido **no iPhone do Rica, via Tailscale**, não em notebook.
2. **Só a mensagem que está streamando muda na tela.** As anteriores não repintam. Verificável por gravação de tela ou pelo devtools do celular.
3. **Quem está lendo o histórico não é arrancado dele.** Mensagem nova chegando com o usuário rolado para cima não move a viewport; aparece indicador de nova mensagem.
4. **Reconexão perceptível em poucos segundos, não em 30.** Bloquear a tela do celular, trocar de wifi para dados e desbloquear: o painel volta a receber sozinho, mostra "reconectando" enquanto isso, e não fica congelado em silêncio.
5. **Paridade semântica total nos transcripts de contrato:** para os mesmos eventos gravados, o painel novo produz o mesmo agrupamento, a mesma ordem e o mesmo conjunto de itens que o antigo. Nenhum evento perdido, duplicado ou reordenado após reconexão.
6. **Uma superfície por vez no celular**, com o botão voltar do sistema fazendo o esperado: fecha a gaveta, depois volta do chat para a lista, e não fecha o app.
7. **Abrir a gaveta não mexe no chat** — nenhum reflow visível na coluna de mensagens.
8. **Deep-link funciona:** abrir `/agente/<slug>` direto do Telegram cai no chat daquele agente, e recarregar a página mantém o lugar.
9. **O microfone funciona no telefone** pelo hostname `.ts.net`, e o primeiro aperto do push-to-talk não perde o começo da fala.
10. **Nenhuma ação destrutiva dispara com um toque só** — permissão, sandbox e effort exigem confirmação, com alvo de toque grande.
11. **Erro no cliente chega para nós:** falha no telefone do Rica aparece do nosso lado sem ele precisar contar.
12. **Rollback em minutos, testado:** voltar para o painel antigo é uma troca de rota, e os links antigos não quebram.

## Ordem de execução aprovada

1. **Instrumentar o painel atual** e gravar os transcripts de contrato. Baseline antes de tudo.
2. **Escrever os contratos:** `STACK.md`, `TOKENS.md` + `globals.css` congelado, `DATA-CONTRACT.md` (assinatura do `convertMessage`, formato do store coalescido, a função única `sendText(slug, texto)` que composer e voz compartilham, e a matriz payload→renderer com um exemplo de cada família), `OWNERSHIP.md` por caminho, e o checklist de equivalência.
3. **Extrair `packages/cockpit-core`** com a lógica que sobrevive, e a lista de cirurgias permitidas nela.
4. **Scaffold sequencial, feito por mim, sozinho** — app `apps/cockpit`, tokens, AppShell com as três colunas, rotas stub. Paralelizar scaffold é onde nascem os conflitos.
5. **Spike do chat, um dia, com o gate dos itens 1 e 2** do comportamento observável. Decide assistant-ui × shadcn-only.
6. **Três frentes por diretório**, worktree própria, rebase diário, merge em janela revisada. Com orçamento de máquina escrito: quantos `next dev` de pé ao mesmo tempo.
7. **Tara** em componentes de contrato fechado (orb em Canvas 2D, diff viewer, renderer de markdown). **Hiro** na cauda longa da matriz de renderers, varredura de hex fora do tema e execução do checklist.
8. **Voz faseada:** fix do `stt-openai.sh` em janela combinada com a frota, depois push-to-talk reusando o que existe, e o modo contínuo por WebRTC só depois de aprovado no celular e verificado o acesso Realtime na conta.
9. **Prova real com agente-canário**, nunca com a sessão viva de ninguém.
10. **Virada** por troca de rota reversível, com os links antigos redirecionando.
