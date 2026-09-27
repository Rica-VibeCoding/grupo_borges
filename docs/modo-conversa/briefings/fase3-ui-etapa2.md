# Fase 3, etapa 2 — implementar a Moldura e a Esfera com escolha na tela (cadeira `ui`)

Você fez a etapa 1 (`briefings/fase3-ui.md`): pesquisa e as direções Núcleo, Moldura e Mostrador. O Rica viu os
mosaicos e decidiu, em 27/09:

> "Vamos de moldura. [...] A gente testar a moldura primeiro." · "Podia deixar para mim decidir depois lá dentro:
> três opções — esfera, moldura, esfera e moldura — e umas duas opções de cada." · "Você manda esse monte de coisa
> legal, eu fico perdido."

O Mostrador saiu. A escolha fica **dentro da tela de conversa**, e não em uma nova rodada de captura.

## O que construir (em `apps/cockpit/components/conversa/`)
1. **Chave de visual** na tela, com três opções: **Moldura** (padrão), **Esfera** (o seu Núcleo) e **Esfera + Moldura**.
   Cada opção tem **2 variações** que sejam realmente diferentes para o olho. Escolha as variações você mesmo e
   dê a cada uma um nome curto em português. Guarde a escolha no `localStorage` do aparelho.
   - A chave fica discreta (um controle, abrindo uma folha ou menu) e não compete com "Encerrar conversa".
   - Ela é o único lugar em que o Rica decide; não vira pergunta para ele.
2. **Ordem de entrega, com parada no meio:**
   - **2a:** Moldura, com as 2 variações, mais a chave (Esfera ainda desabilitada). Pare e escreva PRONTO 2a.
   - **2b:** só depois de a coordenação mandar seguir, a Esfera (2 variações) e a combinação Esfera + Moldura. Pare e escreva PRONTO 2b.
3. A Esfera atual (CSS) e a onda são substituídas; apague o que ficar órfão.
4. Leve à tela de verdade o que já foi aprovado no protótipo: o clarão na troca de vez, a última frase transcrita,
   a resposta do Zé e as cores novas (âmbar = sua vez, violeta = pensando, ciano = respondendo, coral = erro), como
   tokens novos em `app/globals.css` apontando para as cores de estado que já existem.

## Limites (os mesmos da etapa 1, agora valendo em código)
- Não escrever em `lib/conversa/`. Estado só de tela, como o início do silêncio, sai do `vad-web` pelo lado da tela.
- Seis regras do `apps/cockpit/CLAUDE.md`: cor só em `globals.css`, arquivo ≤300 linhas, input ≥16 px, etc.
- WebGL cru, sem `three` e sem nenhum `npm install`. Nível em `ref`, desenho no `requestAnimationFrame`, zero
  `setState` por quadro. Desmontar e liberar o contexto WebGL ao sair. Se o WebGL não subir, cair para CSS.
- A Esfera roda a 30 fps quando pesar. `prefers-reduced-motion` tem versão parada nas três opções.
- Toque ≥44 px, contraste da `cockpit-v2-estetica.md` §3, iPhone Safari primeiro. O pé da Moldura não pode ficar
  escondido sob a barra do Safari: use as `--ck-safe-*` e valide em 393 × 852.
- Fonte: a Geist que o cockpit já hospeda, e não o Google Fonts do protótipo.

## Fecha quando (vale para 2a e 2b)
- `npm test` e `npm run type-check` verdes no PC, com os números no PRONTO.
- O E2E da fase 2 (agente `canarinho`) passa em 4/4 de novo, com a Moldura na 2a e com cada opção na 2b.
- Uma captura por opção/variação na tela real, 393 × 852, em `docs/modo-conversa/e2e/` (não entra no commit),
  e os caminhos no PRONTO.
- **Sem commit.** O diff inclui `docs/modo-conversa/fase3-pesquisa.md` e os `fase3-direcoes/*.html` e
  `capturar.py`; ficam de fora os PNG e os `.webm`. Relato curto em `docs/modo-conversa/relatos/fase3-ui.md`.
