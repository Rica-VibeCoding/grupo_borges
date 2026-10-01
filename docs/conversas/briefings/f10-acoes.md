# F10 — Tela: as ações (cadeira `tela`)

Carregue a skill `frontend-design`. Leia em `docs/conversas/PLANO.md` o "Contrato da API" e a
seção F10. Seu relato da F9 está em `relatos/f9.md`; o código dela já está no `main`
(`f70f8ad`). Os relatos `f5.md` e `f6.md` descrevem as respostas da API. Você não commita.
Relato em `docs/conversas/relatos/f10.md`, até 15 linhas.

## API publicada (VPS, `:8002`, 01/10)

- `POST …/conversas/nova {forcar}` e `POST …/conversas/{id}/retomar {forcar}`: 200 `pronta`,
  502 `{fase: "erro", detalhe}`, 202 se passar de 90 s (a operação segue no servidor).
  409 com `detail`: `ocupado`, `operacao_em_curso`, `motor_sem_conversas`, `desligado` (Nova
  com o agente desligado), além do 409 da atual e da 🔒.
- Retomar com o agente **desligado** não dá 409: sobe direto na conversa pedida.
- `GET …/conversas/operacao` → `{fase, desde, detalhe}`. Provado no canarinho: A → B → A em
  28, 22 e 20 s; Nova conversa em 18 s.
- O detalhe do 502 já vem em português e diz como a linha ficou ("voltou na conversa anterior"
  ou "ligue pelo botão Ligar"). Mostre-o como veio.

## Entrega

A da F10 do plano. Mais duas coisas:

- **Espera que sobrevive:** se a tela recarregar no meio, ela volta a ler o `/operacao` e
  mostra a fase, em vez de botões livres.
- **Furo da F9 que você apontou:** no filtro Especiais, tirar a ⭐ segura a linha até trocar
  de filtro.

## Pronto

`test` e `type-check` verdes contra a base (1 falha antiga em
`configuracao-operacional.test.ts:32`) e capturas 390×844 de: confirmação do Retomar, espera,
erro e confirmação do 🗑. Sem tocar no canarinho de verdade: a cadeira `teste` faz isso na F11.

Viu furo? Escreva no relato; seu caminho vale.
