# Fase 4 — bateria de teste real da tela de voz (cadeira `teste`)

Ordem do Rica (28/09): "testem na tela mesmo, mandando mensagem, vendo como reage, vendo se ele responde. Faça todos
os testes reais como se fosse eu… uma bateria pra ver se ao clicar dá certo, se segurar dá certo, se tem alguma
intercorrência, algum bugzinho entre uma coisa e outra, ou comportamento que não seja usual de UX."

Alvo: dev 3009 no seu clone, com o texto novo da tela de voz (relato `relatos/fase4-ui.md`, seção "texto").
Navegador de verdade (Chromium e WebKit, 390×844), microfone falso tocando FALA GRAVADA de verdade (não silêncio),
indo para o Canário real e esperando ele responder e falar. Nada de mock da API nem do canal.

## Bateria (cada caso em B e em C; "Mostrar texto" ligado, e 1 passada com ele desligado)
1. Tocar para começar → ouvindo → fala → entendendo → pensando → Canário fala → volta a ouvir. Cada estado aparece
   na tela, na ordem, sem pular nem piscar o anterior.
2. Tocar de novo com a conversa andando = parar. Tocar duas vezes rápido não pode ligar e desligar.
3. Segurar 500 ms na vez do Rica: a contagem do silêncio para até soltar; soltar retoma.
4. Falar por cima do Canário (interromper): ele para, a tela vai para ouvindo, a fala nova segue.
5. Silêncio longo depois de começar: o que a tela faz, e se volta sozinha.
6. Deslizar para o chat no meio da conversa e voltar: a conversa para, o chat mostra a troca, a volta não trava.
7. Recarregar a página no meio; rede caindo por 5 s (offline e online de novo): mensagem clara, sem texto velho.
8. Trocar B ↔ C e "Mostrar texto" pelas configurações com a conversa parada e com ela andando.
9. Console: nenhum erro ou aviso vermelho em nenhum caso (inclui o `flushSync` do feed, já consertado).

## Regras
- Só o Canário. Proibido: VPS (ssh/docker/túnel), commit, editar código de produto — achou bug, descreve com passo a
  passo, captura e hipótese de causa, e segue.
- Não reinicie o dev 3009.
- Teto 30% de contexto.

## Fecha quando
- Relato em `relatos/fase4-teste.md` (seção nova): por caso, 🟢/🔴 em B e C, com o que viu; lista de bugs e de
  estranhezas de UX separadas, cada uma com gravidade. Veredito APROVADO ou REPROVADO.
- Última linha sozinha: `FIM-DA-BATERIA`.
