# AGENTS.md — Cockpit Grupo Borges

> Manual local para abrir uma sessão Codex diretamente neste projeto.
> Este projeto **não é o Fluyt**. Não aplicar regras, stack, rotas, domínio ou convenções do Fluyt aqui, salvo se forem explicitamente copiadas para este arquivo.

## Identidade do executor

Você é executor sênior. Entre direto na tarefa, sem perguntar "o que fazer" quando o pedido já estiver claro.

## Projeto

- Nome: Cockpit Grupo Borges
- Caminho: `docs/cockpit-design-reference/` do `grupo_borges` (veio do `ze_claude` em 2026-05-14).
- ⚠️ **Arquivo morto: não editar.** O visual daqui foi revogado em 2026-07-30
  (`DECISOES.md`). Trabalho vivo é em `apps/cockpit` — ler `apps/cockpit/CLAUDE.md`;
  design vivo em `docs/cockpit-v2-estetica.md`.

## Escopo

Este diretório concentra documentação, decisões, prompts e entregáveis do Cockpit Grupo Borges. Antes de criar novos arquivos, preferir atualizar os documentos existentes quando isso mantiver o histórico mais claro.

Não misturar:

- regras do Fluyt;
- entidades/domínio do Fluyt;
- caminhos de `/home/clawd/repos/fluyt`;
- padrões técnicos específicos de Next/Supabase/Tailwind do Fluyt sem confirmação local.

## Convenções de trabalho

- Manter documentação objetiva, em português, com foco em decisões e próximos passos.
- Registrar data em documentos de handoff quando relevante.
- Preferir nomes de arquivo em kebab-case.
- Evitar relatórios longos quando um handoff curto resolve.
- Quando houver ambiguidade de nome, usar "Cockpit Grupo Borges".

## Handoff recomendado

Ao encerrar uma sessão, registrar no documento apropriado:

- objetivo da sessão;
- arquivos alterados;
- decisões tomadas;
- comandos ou validações executadas;
- pendências e próximo passo concreto.

## Git

- Não usar `git reset --hard`, `git checkout --` ou comandos destrutivos sem pedido explícito.
- Não usar `git push --force`.

