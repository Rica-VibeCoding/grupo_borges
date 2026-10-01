# F9 — Tela: a gaveta de leitura (cadeira `tela`)

Carregue a skill `frontend-design`. Leia em `docs/conversas/PLANO.md` o bullet "Gaveta do
agente — UI NOVA", o "Contrato da API" e a seção F9 (com as decisões do Rica). Seu relato da
F8 está em `docs/conversas/relatos/f8.md`; o protótipo e as capturas, em `/tmp/f8/`.
Você não commita. Relato em `docs/conversas/relatos/f9.md`, até 15 linhas.

## Decisões do Rica (01/10)

- **Direção A**, com o "Em uso agora" + Nova conversa da C no topo da lista.
- A porta ocupa o lugar do **Destravar** no cartão Sessão; o Destravar sai da gaveta. A porta
  aparece com o agente ligado **e** desligado.
- O `/clear` sai dos Comandos. "Sem sinal" fica só no pulso.

## API publicada (VPS, `:8002`)

`GET /api/agents/{slug}/conversas` com `bloqueada_por`, `POST …/{id}/estrela`, `DELETE …/{id}`
(F2 e F3 no `main`). `pendencia` vem `null` até a F7: esconda o filtro ⚠️ enquanto for assim.
Nova conversa, Retomar e `/operacao` ainda não existem (F5/F6).

## Entrega

- `?painel=conversas` como terceira visão da `VistaDaGaveta`; porta no lugar do Destravar.
- Cliente no `packages/cockpit-core/src/api.ts`.
- Lista, filtros, busca, tempo relativo, selos e o toque que expande a nota.
- ⭐ funcionando de verdade (a API já existe). Retomar, Nova conversa e 🗑 ficam para a F10.
- Pasta de teste nova incluída no script `test` do `apps/cockpit/package.json` (hoje ele não
  lista `components/gaveta/`).

## Pronto

`test` e `type-check` verdes contra a base da F0 (1508/1510, 1 falha antiga em
`configuracao-operacional.test.ts:32`), e captura 390×844 da gaveta com a porta e da lista
lendo a API real do Pavan. A cadeira `teste` aprova depois.

Viu furo? Escreva no relato; seu caminho vale.
