# Fase 3 — cadeira de teste (`teste`, PC)

Ordem do Rica, 27/09: nenhum link de UI chega a ele sem passar por uma cadeira que **testa a interface de
verdade** — abre a UI, arrasta, mede o tempo de resposta e procura o que quebra. Motivo: os gestos passaram
verdes na cadeira `ui` (17/17 E2E) e no iPhone real a ida para a voz deixou a tela **preta** (print de 27/09,
13:31: dx −296, mola 11 quadros, rota não trocou em 1,2 s).

## Papel
- Você **não edita código do produto**. Quem conserta é a cadeira `ui`. Você escreve e roda testes, mede e dá veredito.
- Seus scripts moram em `docs/modo-conversa/e2e/teste/` (crie). Não mexa nos E2E da `ui`.
- Alvo: o `next dev` já no ar em `http://127.0.0.1:3009` (o mesmo que o Rica abre pelo Tailscale). Não suba nem derrube servidor.

## Como testar (dois motores, porque nenhum é o iPhone)
1. **Chromium com toque de verdade:** perfil iPhone (390×844, `isMobile`, `hasTouch`) e o arrasto por CDP
   `Input.dispatchTouchEvent` (touchStart → vários touchMove a cada ~16 ms → touchEnd). Esse toque passa pelo
   pipeline do navegador (rolagem, listener passivo, `preventDefault`), ao contrário de `dispatchEvent` sintético.
   Rode também com `Emulation.setCPUThrottlingRate` 4× — o iPhone com o dev do PC é mais lento que o seu desktop.
2. **WebKit** (motor do Safari), perfil iPhone, toque sintético — segundo parecer, não prova sozinho.

**Controle positivo primeiro:** antes de confiar no seu teste, ele tem de REPRODUZIR a tela preta do Rica no
código atual (ou você explica por que não reproduz). Teste que nunca vê o defeito não prova o conserto.

## O que conferir, para cada gesto (chat ⬅️ voz · chat ➡️ tropa · voz ➡️ chat)
- Carga fria (primeira visita) e quente; 5 repetições seguidas, ida e volta.
- Arrasto que passa da metade e arrasto curto (tem de voltar com mola).
- Tempo do soltar até a tela de destino **utilizável** (conteúdo real, não o rosto provisório). Registre em ms.
- Captura a cada ~100 ms nos 2 s depois de soltar: **nunca** tela preta/vazia/branca, nunca salto seco.
- Depois do gesto: a rolagem vertical do chat funciona, toques funcionam, o composer digita.
- Erros no console e requisições que falharam.
- A sequência do Rica (27/09), de ponta a ponta: direita abre a tropa · esquerda fecha · esquerda vai à voz ·
  direita volta ao chat · direita abre a tropa · esquerda fecha · esquerda vai à voz · direita volta ao chat. Ao
  fim, `history.length` igual ao do começo (gesto não empilha tela) e nenhum painel montado em dobro nem camada
  sobrando por cima.

## Veredito
Relatório em `docs/modo-conversa/relatos/fase3-teste.md`: lista por item (sem tabela), com números.
Última linha: `APROVADO` ou `REPROVADO — <o que falhou>`, e depois `FIM-DO-TESTE`.
Sem vídeo nem captura para o Rica. Sem commit.
