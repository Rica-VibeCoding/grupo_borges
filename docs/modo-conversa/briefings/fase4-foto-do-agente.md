# Fase 4 — item 5: foto do agente na tela de voz, direções B e C com chave (cadeira `ui`)

Pauta: `docs/modo-conversa/fase4-rodada-da-voz.md`, item 5 e "Anotações do Rica". Base: `main` em `f80d826`
(item 6 já dentro: palavras ao vivo na tela, `fala-da-vez.ts`).

## O que o Rica escolheu (28/09)
- **B — Atividade ao vivo** e **C — Eclipse**, maquetes em `docs/modo-conversa/fase4-direcoes/b.html`, `c.html`
  (e `*-mosaico.png` com os estados). Abrir as duas no navegador antes de codar: a maquete é a especificação.
- Uma **chave em "Configurações da conversa"** (`configuracao-da-conversa.tsx`) escolhe B ou C. Guardar como as
  outras opções dessa tela já guardam. Padrão: B.
- Cores de estado das maquetes: âmbar = vez do Rica, ciano = agente falando, cinza = parado.
- **Tela parada nova, para as duas.** Hoje a tela parada mostra "Conversa por voz… Detector pronto em 2,2 s"; o Rica
  achou "horrível perto da ideia da UI… não comunica com o que a gente tá fazendo". Ela tem de ter a mesma linguagem da
  B/C (foto, aro, cor cinza de parado), com um convite curto para começar. Número técnico (tempo do detector) sai da
  tela principal.
- O ícone de chat sai da tela de voz (o gesto direita → chat já leva).

## Fotos
- Hoje `public/avatars/<slug>.webp` tem 128 px — a C precisa de ≥ 512 px.
- Deixei no seu clone `apps/cockpit/public/avatars/512/<slug>.webp` (512 px, mesmo enquadramento das de 128),
  para barsi, daniel, dimy, felipe, hiro, lucas, maestro, marcio, pavan, tara, vinicius.
- Sem original em alta: **canarinho, caseiro, fluytcom** → usar a de 128 (sem gerar imagem nova). A tela não pode
  quebrar nem ficar borrada de forma feia: se a de 128 não aguenta o tamanho da C, reduza o tamanho da foto nesses três.
- A foto é a mesma da cápsula do chat (`components/shell/capsula-do-agente.tsx`) — reusar a resolução do slug.

## Regras
- Não quebrar o item 6: palavras ao vivo, "Você disse", "Não entendi" sem texto velho, "Mostrar texto" desligado
  sem mudança. Rodar de novo `e2e/fase4-ao-vivo-2.cjs` no fim.
- Esfera, moldura e gestos (segurar, desligar, direita → chat) seguem funcionando nas duas direções.
- Movimento respeita `prefers-reduced-motion`.
- Proibido: VPS (ssh/docker/túnel), commit, falar com agente real além do Canário.
- Teto 30% de contexto: chegou perto, escreva o relato e pare.

## Fecha quando
- Teste vermelho antes para a regra pura nova (ex.: qual direção a chave escolhe, qual foto por slug e tamanho).
- `npm test` e `type-check` verdes, com números.
- Capturas no dev 3009, largura de iPhone (390×844), das duas direções em: parado, ouvindo (com palavras),
  entendendo, agente falando, erro — mais a chave nas configurações. Em `docs/modo-conversa/e2e/fase4-foto/`.
- Relato em `relatos/fase4-ui.md` (seção nova). Última linha sozinha: `FIM-DA-FOTO`.
