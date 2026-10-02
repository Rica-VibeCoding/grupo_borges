# ESTADO.md — Cockpit v2 em produção

> Atualizado em **02/10/2026**. Este é o ponto de retomada: registra o presente.
> Decisões, medições e frentes encerradas ficam nos documentos históricos e no git.

## Agora

- O Cockpit v2 vive em `apps/cockpit` e está em produção na porta `3008`, pela
  unit `cockpit-v2.service` (persistente, usuário `clawd`) na **borges** — a VPS
  Oracle. A `srv1061129` (Hostinger) responde 502: não é mais endereço de nada.
- O Rica acessa somente `https://borges.tailfe77db.ts.net:3446`.
- O desenvolvimento usa a porta `3009`, presa a `127.0.0.1`. A `:3444` foi
  retirada da tailnet em 08/08 e não deve ser enviada ao Rica.
- A API compartilhada roda na porta `8002`, pela unit `cockpit-api.service`; de
  fora, `https://borges.tailfe77db.ts.net:3445`. A `8000` da borges é outro
  serviço (Docker), não a API.
- O Cockpit v1 (`apps/web`) está congelado e **fora do ar** na borges: nada
  escuta na `3007` e a `:3443` não existe no nome `borges`. Mudança nova entra
  no v2.
- Frente em curso: **Conversas** (retomar conversa antiga) — ponto de retomada em
  `docs/conversas/PLANO.md`.

## O que está entregue

- O feed próprio está em `components/feed/**`; a medição descartou
  `assistant-ui`. A decisão e a evidência ficam em `cockpit-v2-gate.md`.
- O v2 cobre o chat da frota, feed de execução, anexos, envio confirmado e
  reconexão. O kanban continua fora desta fase.
- A Tara já opera pelo fluxo sem interface: conversa do despachante, interrupção,
  estado honesto, troca de modelo/esforço e `clear` acompanham a sessão ativa.
- As últimas mudanças de 10/08 fecharam o histórico de 300 mensagens, o `clear`,
  a recuperação de estado antigo e a linha de pensamento no feed.

## Retomada segura

1. Leia `apps/cockpit/CLAUDE.md` antes de tocar o aplicativo.
2. Confirme o trabalho em voo em `tropa_task`; este arquivo não mantém fila nem
   dono temporário.
3. Para contrato de dados, pele, infraestrutura e recorte de arquivos, use os
   documentos abaixo conforme a mudança:
   - `cockpit-v2-data-contract.md`
   - `cockpit-v2-estetica.md`
   - `cockpit-v2-stack.md`
   - `cockpit-v2-ownership.md`
4. `cockpit-v2-playbook.md`, `cockpit-v2-fusao.md`, `cockpit-v2-gate.md` e
   `cockpit-v2-medicao/**` explicam decisões já tomadas; não são instrução
   operacional atual.

## Guardas operacionais

- Não use `next dev` genérico, `pkill next` nem `pkill node`.
- Desenvolvimento e produção não podem dividir o diretório de compilação:
  desenvolvimento usa `COCKPIT_DIST_DIR=.next-dev`.
- Para subir ou derrubar o desenvolvimento, siga
  `apps/cockpit/.claude/skills/subir-cockpit/SKILL.md`.
- Alteração só está entregue quando a produção responde, a URL `:3446` mostra o
  comportamento novo e o Rica consegue conferi-lo.

## Validação mínima

```bash
corepack pnpm --filter @grupo_borges/cockpit type-check   # no notebook: pnpm direto
corepack pnpm --filter @grupo_borges/cockpit test
curl -fsS http://127.0.0.1:8002/health | grep -q grupo_borges-api   # na borges
curl -fsS https://borges.tailfe77db.ts.net:3445/health              # do notebook
curl -fsSI https://borges.tailfe77db.ts.net:3446/
```

Os comandos não substituem a prova de tela quando a alteração é visível.
