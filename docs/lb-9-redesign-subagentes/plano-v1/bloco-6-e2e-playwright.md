# Bloco 6 — E2E Playwright

## Escopo

Testes Playwright cobrindo os fluxos críticos do LB-9: spawn via Popover, limite de 3, badge SSE-independente, worktree criado/limpo, e limpeza de zumbi. A-automático saiu do v2 (backlog).

## Arquivos tocados

- `/home/clawd/repos/grupo_borges/apps/web/tests/e2e/lb9-subsessions.spec.ts` ← novo arquivo de spec
- `/home/clawd/repos/grupo_borges/apps/web/tests/e2e/fixtures/` ← fixtures de agente/task se necessário (verificar padrão existente)
- `/home/clawd/repos/grupo_borges/apps/api/tests/test_spawn_subsession.py` ← testes unitários/integração do endpoint spawn

> Verificar: padrão atual de testes Playwright no projeto (diretório, configuração, fixtures). Ler `apps/web/tests/` ou `playwright.config.ts` antes de criar spec.

## Pré-condições

- Blocos 1–5 concluídos
- App rodando em `:3007` (Tailscale Serve) ou em URL de teste configurada no Playwright
- Agente de teste com workspace configurado (usar `conectamovelmar@gmail.com` workspace — nunca lojista real)

## Context7 — queries Tara consulta ANTES de codar

```
resolve_library_id("playwright")
get_library_docs(<id>, topic="waitForResponse intercept API calls")
get_library_docs(<id>, topic="webkit mobile viewport testing")
get_library_docs(<id>, topic="fixtures page setup teardown")
```

Relatório salvo em `/tmp/tara-bloco-6-context7.md`. Confirmar padrão de intercept de chamadas API antes de mockar o spawn.

## Passos

1. **Ler** configuração Playwright existente (`playwright.config.ts`) e qualquer spec existente pra seguir o padrão do projeto.
2. **Criar** `lb9-subsessions.spec.ts` com os cenários abaixo (passos 3–7).
3. **Cenário: spawn básico visible**
   - Navegar até task com agente-pai ativo
   - Clicar `[+ Subsessão]`, selecionar skill no Combobox, deixar `visibility=true`
   - Verificar que Popover fecha após submit e lista mostra 1 subsessão
   - Verificar que badge no card do agente incrementou (aguardar ≤ 6s)
4. **Cenário: spawn background**
   - Spawnar com `visibility=false`
   - Verificar que badge NÃO aparece no card do agente
   - Verificar que o Popover lista a subsessão como background
5. **Cenário: limite de 3**
   - Mockar 2 subsessões ativas já existentes (via API ou fixture)
   - Tentar 3º spawn → deve funcionar
   - Tentar 4º spawn → deve retornar erro e UI exibir mensagem "Limite atingido"
6. **Cenário: badge SSE-independente (fix JP-11)**
   - Abrir cockpit com card do agente visível mas modal fechado
   - Spawnar subsessão via API diretamente (`fetch POST` no teste)
   - Aguardar ≤ 6s e verificar que badge incrementou sem abrir modal
7. **Cenário: skill inválida**
   - Tentar spawn com skill que não existe no workspace → UI exibe erro `400`
8. **Cenário: worktree criado e limpo (smoke real)**
   - Spawn via API → verificar `git worktree list` mostra `/tmp/subsession-<id>`
   - Aguardar subsessão fechar (`status=done`) → verificar worktree foi removido
   - Cleanup: matar a sessão tmux manualmente se cenário falhar

## Critério de aceite

- Todos os 6 cenários passam em `chromium` e `webkit` (iPhone 15 proxy)
- Sem flakiness em 3 rodadas consecutivas
- `npx playwright test lb9-subsessions` retorna `6 passed`
- Teste unitário Python: `pytest test_spawn_subsession.py` cobre validações de permissão + limite + skill + worktree helper

## Riscos específicos

- **Spawn real cria processo tmux:** testes E2E que disparam spawn real vão criar sessões tmux na VPS. Usar mock/intercept da API no Playwright pra não criar processos reais nos testes. Só o teste de "badge SSE-independente" chama a API real e precisa de cleanup.
- **WebKit mobile:** Rica usa Chrome iPhone 15 (WebKit por baixo). Obrigatório rodar cenários de Popover em `webkit` — `overflow:hidden` em card pode cortar Popover, descoberto só no mobile.
- **Flakiness em SSE:** cenários que aguardam badge via SSE podem ser instáveis. Fallback: usar o polling de 5s como referência de tempo máximo no `waitFor` (timeout 7s).
- **Agente de teste:** não usar agente de produção nos testes. Fixture deve criar agente efêmero com workspace `conectamovelmar@gmail.com` e deletar após.
