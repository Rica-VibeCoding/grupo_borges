# Fase 3 — UI dedicada (cadeira `ui`, Claude Code `claude-opus-5-5`)

Leia antes: `AGENTS.md` do repo, `apps/cockpit/CLAUDE.md` (as seis regras), o plano
`docs/cockpit-v2-modo-conversa-PLANO.md` (§ Decisões, § Fase 3, riscos), `docs/cockpit-v2-estetica.md`
(tokens, piso de contraste, movimento), `docs/cockpit-v2-playbook.md` § "Orb e botão", o relato
`docs/modo-conversa/relatos/fase2-tela.md` e o código de hoje: `apps/cockpit/app/conversa/[slug]/`,
`apps/cockpit/components/conversa/` e o contrato `apps/cockpit/lib/conversa/tipos.ts`.

## O pedido do Rica
"A melhor UI possível, bem pesquisada, bonita, futurística — quero que me impressione." Tela cheia de conversa
por voz com um Zé, usada sobretudo no **iPhone (Safari, 393 × 852)**, de relance ou sem olhar. Hoje é uma
esfera CSS, um botão e textos soltos: funciona, não impressiona.

## Etapa 1 — AGORA: pesquisa e direções. Nenhum código de produção.
1. **Pesquisa de referência** (web): modos de voz do ChatGPT, Claude, Gemini Live, Siri do iOS 18+, ElevenLabs UI
   (`Orb`), Hume, Sesame, e o que houver de mais recente e melhor; HUD de cinema/jogo que sirva de linguagem.
   Anote o que presta e por quê em `docs/modo-conversa/fase3-pesquisa.md` (curto, com links).
2. **2 ou 3 direções visuais** realmente diferentes entre si, cada uma um HTML autônomo em
   `docs/modo-conversa/fase3-direcoes/<nome>.html`, animado de verdade (o nível de voz pode ser simulado).
   Cada direção mostra os estados que o Rica vai viver: **preparando, ouvindo, esperando o Zé, falando,
   interrompendo, erro**, mais a chave "estou de fone" e a última frase transcrita.
3. **Capturas:** para cada direção, um PNG-mosaico com os estados lado a lado em 393 × 852
   (`fase3-direcoes/<nome>.png`), tirado em Chrome headless como no E2E da fase 2. Se o movimento for o ponto
   forte, grave também um vídeo curto (≤10 s, `.mp4`/`.webm`).
4. Para cada direção, 3 linhas: a ideia, a técnica (CSS, Canvas 2D, WebGL/shader, biblioteca?) e o custo
   (KB gzip, GPU no iPhone).

## Limites que valem já no desenho (a direção que os fura não serve)
- A lógica não muda: estados e eventos são os de `lib/conversa/tipos.ts`. Não escrever em `lib/conversa/`.
- Cor só em `app/globals.css` quando virar código: desenhe pensando em tokens novos na §A pele.
- Contraste da `cockpit-v2-estetica.md` §3; `prefers-reduced-motion` tem versão parada; alvo de toque ≥44 px.
- iPhone primeiro: nada de 60 `setState`/s (nível em `ref`, desenho no `requestAnimationFrame`); biblioteca 3D
  pesada (`three` + r3f) só com justificativa de peso; desmontar canvas ao sair.
- Quem ouve não olha a tela: o estado tem de ser legível por cor/forma de relance, não só por texto.

## Fecha quando (etapa 1)
PRONTO com os caminhos dos PNGs (e vídeos) e as 3 linhas por direção. **Sem commit, sem `npm install`, sem
tocar `apps/`.** A coordenação leva as capturas ao Rica; só a direção aprovada vira código (etapa 2, briefing
próprio: implementar em `components/conversa/`, `npm test` + `type-check` verdes, E2E 4/4 da fase 2 de novo).
