# scripts/prova — o que o `node --test` da suíte não monta sozinho

Provas de componente que precisam montar o React de verdade (`BlocoDeAcoes`,
gaveta, véu de operação) num DOM simulado. Não substituem teste. **Régua de
origem** (`daniel/AGENTS.md`): defeito tem teste que falha antes do fix; onde não
cabe teste automatizado, define-se na entrada o comando que prova e roda-se ele
no fim. Isto é esse comando.

## Rodar

```bash
cd apps/cockpit && node --test scripts/prova/*.test.cjs
```

## O que existe

- `operacao-unica.test.cjs` — escolher na gaveta aplica sozinho, e só quando a escolha não vale na sessão viva.
- `veu-de-operacao.test.cjs` — a trava de tela nasce na fase `aplicando`, cobre o viewport e sai sozinha.
- `seletor-familia.test.cjs` — o seletor de família do motor; bancada em `seletor-familia-harness.cjs`.

## Prova que precisa de navegador de verdade

Foco, teclado e o que a tela realmente mostra: pela skill `browser-harness` da
frota — Playwright não existe mais aqui. O dev da 3009 escuta só em `127.0.0.1`
da Oracle, e o Chrome do agente mora no PC: expor a porta a ele é o primeiro
passo quando a primeira prova dessas nascer.

**Falha se simula NO CLIENTE, nunca derrubando serviço** (`Fetch.enable` +
`Fetch.fulfillRequest` pelo `cdp(...)`). A `cockpit-api` é unit transiente:
`systemctl --user stop` **apaga a unit** e o `start` seguinte responde `Unit not
found` — detalhe em `ze-shared/memory/shared_quem_matou_sobe.md`.
