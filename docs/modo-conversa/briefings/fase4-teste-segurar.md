# Fase 4 — cadeira `teste`: silêncio de 2 s e segurar para pensar

Regras de sempre em `briefings/fase3-cadeira-de-teste.md` (papel, dois motores, controle positivo, veredito). O que
mudou está em `briefings/fase4-silencio-e-segurar.md` e no relato da `ui`, `relatos/fase4-ui.md`. O diff está na árvore
do PC, sem commit; o dev da 3009 já está no ar.

## O que conferir (tela de voz, perfil iPhone, toque por CDP, também com CPU 4×)
- Fala com pausa de 1,5 s continua uma fala só; silêncio de ~2 s entrega.
- Segurar: dedo parado ≥ 500 ms em `ouvindo` segura; calar segurando 5 s não entrega; soltar entrega ~2 s depois,
  **uma** transcrição e **um** envio. Repetir segurando depois de silêncio longo (≥ 2 s antes de segurar).
- Controle positivo: mostre que o seu teste pegaria a fala saindo no soltar (por exemplo, sem esperar os 2 s depois
  do soltar) — ou explique por que não reproduz.
- O que não pode quebrar: toque rápido para em todo estado; dedo parado fora de `ouvindo` não faz nada e o soltar não
  vira toque; arrasto direita → chat e cima → configurações seguem; segurar e depois andar não vira gesto; toque duplo
  segue ignorado em 400 ms; segundo dedo não solta a vez.
- Volta visual e som: luz baixa enquanto segura e volta ao soltar, sem salto seco nem tela preta.
- A sequência do Rica de 27/09 (chat ⇄ tropa ⇄ voz) de ponta a ponta, `history.length` igual no fim.
- Envio: o canarinho está fora na VPS; use `E2E_ENVIO=simulado` como a `ui` e deixe isso escrito no relato.

## Veredito
Relatório em `relatos/fase4-teste.md`, lista por item com números. Última linha: `APROVADO` ou
`REPROVADO — <o que falhou>`, e depois `FIM-DO-TESTE`. Sem commit, sem mexer no código do produto.
