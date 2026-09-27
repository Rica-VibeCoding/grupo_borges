# Pesquisa do toque — um toque inicia, um toque para

> Canário, 27/09/2026, pedido do Daniel. Li o PLANO (R6), a `pesquisa-desenho.md`, a máquina
> (`lib/conversa/`) e o backend (`apps/api`); afirmação de código vem com arquivo:linha.
> **PROVA** = está na fonte citada. **SUPONHO** = dedução minha.

---

## 1. Apps de referência — o que um toque faz em cada momento

**ACHADO (PROVA).** O Zello, walkie-talkie, tem as duas gramáticas e deixa o usuário escolher: o
padrão é **segurar para falar e soltar para parar**; em Ajustes → botão PTT existe **"aperte uma vez
para falar, aperte de novo para terminar"**. É o precedente mais direto do pedido do Rica. A proteção
contra toque acidental é **estado visível**: a borda do botão fica verde depois do "chirp" (um som
curto) e vermelha quando a transmissão é recusada.

**ACHADO (MÉDIA — fonte secundária).** No **ChatGPT voz**, calar o assistente exige **toque manual**:
ele não para sozinho quando você começa a falar. Existe o "Manual Hold" (segurar a tela faz ouvir até
soltar) e o encerrar é um **botão separado**, não a tela inteira. No **Gemini Live** é o contrário: ele
**interrompe sozinho** quando você fala, e a tela tem botões próprios de **End** e **Hold**.
Ou seja: as duas referências separam *calar* de *encerrar* — a tela inteira como botão é invenção nossa.

**ACHADO (PROVA).** O widget da ElevenLabs não usa toque na tela: expõe `mic_muting_enabled` (botão de
mudo), os rótulos "Listening…"/"Assistant speaking", e `startConversation()`/`endConversation()`.
Encerrar é comando explícito.

**EVIDÊNCIA.** Zello: `support.zellowork.com` (manual de usuário, lido 27/09/2026). ChatGPT/Gemini:
comparativo TechWiser (2024) e fórum da OpenAI — **não são doc oficial**. ElevenLabs: DeepWiki do
pacote `elevenlabs/packages` §"Widget configuration" (lido 27/09/2026).

**RECOMENDAÇÃO.** Copiar do Zello a **escolha de gesto** e a **confirmação por som+cor**; copiar do
ChatGPT/Gemini a **separação entre calar e encerrar** — que é exatamente a nuance que falta no plano.
Não achei nenhuma referência que faça "tocar em qualquer lugar = encerrar tudo", e é justamente isso
que torna o toque acidental caro. Confiança MÉDIA.

---

## 2. Cada estado nosso — o que o toque deve fazer

**ACHADO (PROVA).** A máquina hoje só trata o toque de **iniciar** (`comecar`, idempotente — repetir
fora de `parado`/`erro` não faz nada, `maquina.ts:104-109`) e de **encerrar** (`parar`, que só desliga o
detector, `maquina.ts:111-116`). Quem faz o trabalho pesado no encerrar é a tela, não a máquina:
`use-modo-conversa.ts:250-258` já corta a voz (`cancelaFala`), cancela os sons locais, solta o Wake
Lock e invalida o ciclo em voo antes de despachar `parar`.

**ACHADO (PROVA).** Com o agente já rodando, o envio é **recusado no cliente**: `agenteOcupado`
(`use-modo-conversa.ts:132-135`). O `enviar` da máquina não tem porta de entrada durante `falando`.

Proposta estado por estado:

- **parado** → inicia. Tem de ser no mesmo tick do gesto (áudio, microfone e Wake Lock dependem disso,
  `use-modo-conversa.ts:241-247`). Com o detector ainda "preparando", o toque não faz nada e a tela
  precisa dizer por quê — a fase 0 mediu 4 toques = 4 detectores.
- **ouvindo** → encerra. A fala em curso é **descartada**: o detector desliga e o trecho nunca vira
  `falaTerminou`. É o comportamento certo para "para", mas perde a frase — vale um som diferente.
- **transcrevendo** → encerra e descarta o resultado. O `cicloRef` invalida a resposta em voo
  (`use-modo-conversa.ts:251`) e a máquina ignora `transcreveu` fora de `transcrevendo`
  (`maquina.ts:151-152`). O POST continua cobrando, sem efeito.
- **esperandoZe** → encerra e para de esperar (morrem a frase-ponte e o aviso de demora). O turno do
  Zé **continua no servidor** — ver §3.
- **falando** → **corta a voz e volta a ouvir; não encerra a conversa.** Segundo toque, agora em
  `ouvindo`, encerra. Razão: sem fone o detector está surdo durante a fala (`maquina.ts:59-62`), então
  o toque é o **único** jeito de calar o Zé — e calar para falar é o gesto mais frequente. É o que o
  ChatGPT faz e o que o Rica pediu na fase 2 ("cortar a voz quando eu falo por cima").
- **interrompendo** (fase 2, com fone) → encerra e joga a voz pausada fora. Engolir o toque até a
  janela de confirmação fechar seria pior.
- **erro** → reinicia: `comecar` já aceita sair de `erro` (`maquina.ts:105`). É o "tenta de novo".

**RISCO (PROVA de que existe, e é o furo maior).** Cortar a voz em `falando` **não faz o Zé parar de
produzir texto**. Pela máquina, o texto seguinte, vindo em `ouvindo`, entra em `falando` e a voz
volta (`maquina.ts:167-186`). O corte só é definitivo se marcar o turno como descartado, como faz o
`falaConfirmada` (`maquina.ts:242-248`, flag `zeDescartado`). Sem isso o toque "cala" por dois
segundos e a voz reaparece.

**RECOMENDAÇÃO.** Implementar o toque como **três ações distintas por estado**, não uma: iniciar,
calar (em `falando`) e encerrar. E o corte em `falando` tem de reusar o caminho do `zeDescartado`.
Confiança ALTA — é leitura direta da máquina.

---

## 3. Backend — o que acontece com o turno do Zé

**ACHADO (PROVA).** **Existe caminho de cancelar o turno pela API, e ele já está no cliente:**
`POST /api/agents/{slug}/interromper` (`apps/api/routers/agents.py:4136`) faz
`tmux_driver.send_named_key(sessão, "Escape")` (`agents.py:4153`). A docstring diz o essencial: "O
freio não é destrutivo: Escape no pane… A sessão continua viva e a conversa inteira permanece", e não
pede confirmação de propósito porque interromper é reversível. No cockpit, a função é
`packages/cockpit-core/src/api.ts:504` e quem chama é o `■` do composer
(`components/shell/composer.tsx:249`, usado em `:1218`).

**ACHADO (PROVA).** Hoje o modo conversa **não** chama essa rota em `parar`: `use-modo-conversa.ts:250-258`
só mexe no cliente. Logo, ao encerrar com o Zé pensando, **o turno continua gerando** e a resposta
chega depois no feed de texto — o R6 descrito no plano. O termo `absorbed_mid_turn` **não existe no
código**: aparece só nos docs (é observação da frota, não constante).

**ACHADO (PROVA).** Envio no meio de turno tem contrato próprio: `/input` devolve recibo estruturado
com `delivery_outcome` (`refused`/`uncertain`) e `safe_to_resend` (`api.ts:377-387`), e há 409
conhecidos (`agent_pane_unavailable`, `shared_turn_in_flight`, `apps/cockpit/lib/recusa-transitoria.ts:57`).
Esse arquivo registra a sequência real vivida em 15/08: `input 200` ×3 → `interromper 200` → **`input 409`**
→ `interromper 200` → `input 200` — isto é, **logo depois de um interrupt o envio seguinte pode ser
recusado** e passa sozinho em segundos.

**RISCO.** Ligar Escape automático em todo `parar` aumenta a chance de o próximo envio cair no 409 —
o cockpit já retenta esse caso (`recusa-transitoria.ts:63`, 1,2 s e 3 s), mas são números de projeto,
nunca medidos (o próprio arquivo avisa).

**RECOMENDAÇÃO.** Ao encerrar em `esperandoZe` ou `falando`, com `isRunning` verdadeiro, chamar
`/interromper` **junto** com o `parar`. Sem isso, o "completo" que o Rica pediu não fecha: a conversa
acaba na tela e a resposta aparece sozinha no chat minutos depois. Confiança ALTA de que a rota existe
e serve; MÉDIA sobre o efeito colateral do 409.

---

## 4. Retorno ao usuário — confirmar o toque sem texto

**ACHADO (PROVA).** **Vibração não existe no iPhone.** O WebKit mantém posição formal
**"position: oppose"** para a Vibration API (issue #267, aberta em 14/10/2023, fechada), com as
razões: incômodo, dependência de aparelho, portabilidade e bateria. Na prática a API só existe no
Blink. O truque de haptics via `<input type="checkbox" switch>` escondido funcionou no iOS de ~17.4
a 26.4 e a Apple **fechou no 26.5** — agora só dispara com toque físico no próprio controle.

**ACHADO (PROVA).** O que sobra no Safari do iPhone é **som** (o `AudioContext` já está destravado
pelo gesto de início) e **forma/cor**. É exatamente o desenho do Zello: um "chirp" antes de
transmitir e a borda mudando de cor.

**EVIDÊNCIA.** `github.com/WebKit/standards-positions/issues/267`; issue `flarum/framework#4694`
(haptics mortos no iOS 26.5+); MDN `Navigator.vibrate` ("Limited availability", não é Baseline).

**RECOMENDAÇÃO.** Um som curto **distinto por ação** (iniciar ≠ calar ≠ encerrar) e a forma mudando
de estado — é o que a tela já faz com a esfera e a moldura. `navigator.vibrate` pode entrar como
bônus com detecção de presença, **nunca** como o aviso principal. Confiança ALTA.

---

## Fecho — estado → o que o toque faz

- **parado** → inicia (gesto síncrono: áudio + microfone + Wake Lock)
- **ouvindo** → encerra (descarta a fala em curso)
- **transcrevendo** → encerra (descarta o resultado)
- **esperandoZe** → encerra (+ `interromper` se `isRunning`)
- **falando** → **cala e volta a ouvir** (marca `zeDescartado`); segundo toque encerra
- **interrompendo** → encerra e joga a voz pausada fora
- **erro** → reinicia

Fora da área: o topo (Voltar e configuração), como o briefing pede. Toque acidental: o que protege é
o **estado visível + som diferente + o segundo toque para encerrar de verdade** — que é a defesa
barata e já consagrada no Zello.

## O que eu não consegui provar

- O comportamento exato do ChatGPT e do Gemini Live: só achei comparativo de imprensa, não doc oficial.
- Se `/interromper` deixa o `isRunning` do stream cair na hora. Não li o lado do WebSocket com calma.
- Se a Apple devolve os haptics no iOS 27 (há relato de beta, não confirmado).
