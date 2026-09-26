# Briefing — pesquisa de desenho: modo conversa por voz (Daniel → Canário, 26/09/2026)

**Tarefa:** pesquisar na comunidade de dev (GitHub issues/discussions/repos, blogs de engenharia,
HN, Reddit, docs oficiais) qual é o desenho VALIDADO em 2025–2026 para conversa por voz em tempo
real no navegador, com um cérebro PRÓPRIO no meio, e dizer onde o nosso plano diverge. Use a sua
skill `pesquisa` se couber.

**Leia antes:** `grupo_borges/docs/cockpit-v2-modo-conversa-PLANO.md` (o nosso desenho) e o §11 de
`grupo_borges/docs/cockpit-v2-fala-em-tempo-real.md` (o que já medimos da OpenAI).

**Restrição dura do Rica:** quem pensa é o Claude Code do agente (resposta leva segundos, às vezes
minutos com ferramenta). Modelo de voz que é o próprio cérebro (OpenAI Realtime conversa, Gemini
Live) está FORA — só entra se for como "recepção" na frente do Zé, e aí quero saber quem faz isso.

**Perguntas, nesta ordem:**
1. Arquitetura em cascata (ouvir → cérebro → falar): como LiveKit Agents, Pipecat e similares
   montam. Qual peça roda no navegador e qual no servidor.
2. Fim da fala: VAD por energia × Silero no navegador (`@ricky0123/vad-web`) × detector semântico
   de turno (turn detector do LiveKit, smart-turn do Pipecat). Qual tempo de silêncio o pessoal usa.
3. Fala por cima (barge-in) com o alto-falante tocando: o cancelamento de eco do navegador cobre
   áudio tocado por `<audio>`/`HTMLAudioElement`, ou só por WebRTC? Diferença Chrome × Safari iOS.
4. Cérebro lento: como disfarçam 5–60 s de espera (frase-ponte, aviso de progresso, falar em
   pedaços conforme o texto chega).
5. iOS Safari: reprodução sozinha depois do primeiro toque, microfone aberto por minutos, tela
   bloqueada.
6. Custo: transcrição ao vivo mandando áudio só quando há fala, é prática comum? Armadilhas.

**Entrega:** `grupo_borges/docs/modo-conversa/pesquisa-desenho.md`, até ~200 linhas. Por pergunta:
ACHADO · EVIDÊNCIA (link + data da fonte) · RISCO · RECOMENDAÇÃO. Fecha com "Onde o plano do Daniel
diverge", item por item. Separe o que a fonte PROVA do que você supõe. Resumo de busca só serve pra
achar link — fala atribuída se confere na fonte.

**Limites:** não toque em código, não commite, não edite o plano. Só crie o arquivo de entrega.
**Ao terminar:** ping de uma linha para mim — `tmux -L borges-daniel send-keys -t daniel -l
'[canario] pesquisa pronta em <caminho>'`, e o Enter numa segunda chamada separada. Se travar,
avise pelo mesmo caminho. Se enxergar furo no próprio briefing, diga — você vai estar com as fontes
na frente e eu não.
