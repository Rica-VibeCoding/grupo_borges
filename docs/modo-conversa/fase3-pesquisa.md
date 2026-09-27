# Fase 3 — pesquisa de referência da UI do modo conversa

Cadeira `ui` · 26/09/2026 · etapa 1, antes de qualquer código.

## O que presta, e por quê

- **Siri do iOS 18+ (Apple Intelligence).** A esfera saiu do pé da tela e virou luz na borda inteira, reagindo à
  voz; ao chamar, a moldura "aperta" como se o aparelho fosse espremido. Presta: o próprio celular vira o
  indicador, visível com o canto do olho, sem cobrir nada. Não presta: o arco-íris não diz de quem é a vez.
  [pocket-lint](https://www.pocket-lint.com/how-to-get-new-siri-look-glowing-border/) ·
  [techradar](https://www.techradar.com/phones/ios/the-next-siri-will-make-it-look-like-youre-squishing-your-phone-and-other-secrets-of-apple-intelligence-you-may-have-missed)
- **Gemini Live (redesenho "neural expressive", 2026).** Brilho enevoado de forma sempre mudando e fundo em
  gradiente que pulsa enquanto processa. Presta: brilho como atmosfera, não como objeto. Não presta: cor sem
  semântica de estado. [Android Authority](https://www.androidauthority.com/gemini-overlay-live-neural-design-apk-teardown-3690991/) ·
  [9to5Google](https://9to5google.com/2026/05/03/gemini-full-redesign/)
- **ChatGPT Voice.** A esfera azul em tela cheia foi o ícone; desde 25/11/2025 a voz vive dentro do chat, com a
  transcrição à vista (o modo separado continua existindo). Presta: ver o que foi entendido importa mais que a
  esfera. Não presta: esfera sozinha não diz se é a sua vez.
  [TechCrunch](https://techcrunch.com/2025/11/25/chatgpts-voice-mode-is-no-longer-a-separate-interface/)
- **ElevenLabs UI `Orb`.** `three` + `@react-three/fiber` + `drei`; um fragment shader com 7 ovais em
  coordenada polar sobre textura Perlin; dois canais separados, `inputVolume` e `outputVolume`; estados
  `null | thinking | listening | talking`. Presta: volume de quem fala e volume de quem responde em canais
  distintos — nós já temos os dois (RMS do microfone, picos do TTS). Não presta: ~200 KB gzip para uma tela, e
  o estado só muda velocidade, não forma. [docs](https://ui.elevenlabs.io/docs/components/orb) ·
  [código](https://github.com/elevenlabs/ui)
- **LiveKit Agents UI.** Cinco visualizadores (barra, grade, radial, onda, aura) com o mesmo contrato
  `(audioTrack, state)`; estados `connecting, initializing, listening, thinking, speaking, failed`. Presta: é
  o nosso contrato — `Estado` + nível entram, desenho sai; trocar o visual não toca na lógica.
  [docs](https://docs.livekit.io/frontends/agents-ui/audio-visualizer/prebuilt/)
- **Sesame (Maya/Miles, 02/2025).** O que impressionou foi a voz — prosódia, tempo, interrupção natural —, não a
  tela. Presta como freio: a UI não pode atrasar nem esconder o turno.
  [Sesame](https://www.sesame.com/research/crossing_the_uncanny_valley_of_voice)
- **Hume EVI 3.** Aposta em prosódia e emoção; a demo não tem linguagem visual marcante. Nada a copiar.
  [Hume](https://www.hume.ai/blog/introducing-evi-3)
- **Claude (app).** Não achei fonte confiável sobre o visual do modo voz; fica fora.

## HUD de cinema

- **Territory Studio, *Blade Runner 2049*.** "Nenhuma tela decorativa": cada gráfico serve a um ponto da história;
  tecnologia "abstrata, tangível, óptica, orgânica". Presta: num mostrador, todo tique tem de medir algo real
  (silêncio até enviar, 5 s da frase-ponte, 20 s do aviso). HUD sem dado é enfeite.
  [Territory](https://territorystudio.com/project/blade-runner-2049/) ·
  [AWN](https://www.awn.com/vfxworld/communicating-abstract-user-interfaces-blade-runner-2049)
- **Geoff McFetridge, *Her* (2013).** Interface de voz que não chama atenção: "o melhor design te convida a sair
  dele". Presta: quem ouve não olha; a tela é ambiente, não palco.
  [Gizmodo](https://gizmodo.com/an-interview-with-geoff-mcfetridge-on-the-interfaces-fr-1526237090)

## Princípios que saíram daqui (valem para as três direções)

1. **Estado por posição + forma + cor.** Texto é a quarta camada, para quem olha de perto.
2. **Quente = sua vez; frio = vez dele.** É a tese da estética §1.3 ("a temperatura sobe quando a máquina
   precisa de você") aplicada à conversa: ouvindo em âmbar, pensando em violeta, respondendo em ciano, erro em
   coral, preparando em neutro. **Muda a esfera de hoje** (ouvindo ciano, falando verde).
3. **Nenhuma cor nova.** Cinco tokens `--ck-conversa-*` na §A apontando para os de estado: contraste já
   calculado na §3, nada a revalidar.
4. **Dois canais de volume**: microfone e voz do Zé. O desenho sabe de quem é pelo estado.
5. **Parado de verdade** com `prefers-reduced-motion`: cada direção tem um quadro fixo por estado.
6. **Sem biblioteca 3D.** `three` + r3f custa 150–230 KB gzip (playbook §4); WebGL cru ou Canvas 2D fica em
   3–6 KB.

## As três direções (etapa 1)

HTML autônomo em `fase3-direcoes/<nome>.html`: no PC abre com painel de estados e botão de movimento reduzido;
no celular roda o roteiro sozinho. Mosaico `<nome>.png` e vídeo `<nome>.webm` (9,6 s) saem de
`fase3-direcoes/capturar.py`, com relógio simulado — quadro e vídeo são reproduzíveis. Peso = código visual
(shader + desenho), gzip, medido; GPU no iPhone é estimativa, não medida.

- **Moldura.** A borda da tela é o indicador: luz sobe do pé (sua vez), desce do topo (ele fala), orbita
  (pensa), desenha a moldura (download), abre uma falha no pé (erro); clarão na troca de vez. WebGL cru, um
  fragment shader sem laço, em 0,6× da resolução. ~3,2 KB gzip; GPU baixa. Risco: no Safari com barra, o pé
  da moldura fica sob a barra — lê inteira como app na tela de início.
- **Mostrador.** Instrumento que mede a conversa: barras para dentro = sua voz, para fora = a dele; o arco do
  meio conta o que importa (1,4 s até enviar, 5 s da ponte, 20 s do aviso, 0,5 s da confirmação). Canvas 2D,
  ~200 traços por quadro, número em DOM. ~2,9 KB gzip; GPU mínima. Precisa de um dado só de tela: o início do
  silêncio, pelo `onFrameProcessed` do `vad-web`, para a contagem de 1,4 s.
- **Núcleo.** Matéria viva: ondula puxada para você ao ouvir, recolhe com veios de luz ao pensar, pulsa em
  ondas ao falar, vira gema facetada ao interromper, encolhe e racha no erro; as palavras ficam em destaque
  embaixo. WebGL cru, raymarching com ruído simplex (64 passos) em 0,75×, sem `three`. ~4,0 KB gzip; GPU
  média — o mais pesado: medir no iPhone; se pesar, 30 fps e menos passos.
