# F12 — Tela: acabamento depois da F11 (cadeira `tela`)

Carregue a skill `frontend-design`. Leia `docs/conversas/relatos/f11.md` (a cadeira `teste`
percorreu tudo na `:3446`, APROVADO com furos) e o seu `relatos/f10.md`. Código no `main`.
Você não commita. Relato em `docs/conversas/relatos/f12-tela.md`, até 12 linhas.

## Furo medido pela `teste` (capturas no Omarchy, `/tmp/f11/`)

**Nova conversa com alerta falso.** Em 1 de 7, a tela mostrou "o /clear não chegou ao agente"
com o cartão velho, e a troca já tinha sido feita (apareceu ao recarregar). Em outra, cartão e
lista ficaram velhos depois da espera. Você já tinha apontado o segundo no seu relato ("sem
recibo explícito depois de `pronta`"). Descubra de onde vem o alerta (resposta da API ou
régua da tela) e conserte: depois de `pronta`, cartão e lista refletem a troca. Se a causa
for da API, escreva no relato com a prova, sem mexer em `apps/api`.

## Pronto

`test` e `type-check` verdes contra a base (1 falha antiga em
`configuracao-operacional.test.ts:32`).

Viu furo? Escreva no relato; seu caminho vale.
