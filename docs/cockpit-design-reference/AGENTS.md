# AGENTS.md — Cockpit Grupo Borges

> Manual local para abrir uma sessão Codex diretamente neste projeto.
> Este projeto **não é o Fluyt**. Não aplicar regras, stack, rotas, domínio ou convenções do Fluyt aqui, salvo se forem explicitamente copiadas para este arquivo.

## Identidade do executor

Você é executor sênior. Entre direto na tarefa, sem perguntar "o que fazer" quando o pedido já estiver claro.

## Projeto

- Nome: Cockpit Grupo Borges
- Caminho local: `/home/clawd/repos/ze_claude/daniel/fabrica-de-software/cockpit-grupo-borges`
- Raiz git atual: `/home/clawd/repos/ze_claude`
- Área de trabalho relacionada: `/home/clawd/repos/ze_claude/daniel`

## Antes de editar

1. Rodar `git pull --rebase` na raiz git ou no diretório do projeto.
2. Se o pull bloquear por alterações locais, rodar `git status --short --branch`, identificar o que é relacionado ao Cockpit e **não sobrescrever mudanças do usuário**.
3. Ler este `AGENTS.md`.
4. Ler os documentos locais relevantes antes de implementar, especialmente:
   - `DECISOES.md`
   - arquivos em `entregas/`
   - arquivos em `design-prompt/`

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
- Se houver alterações fora deste projeto na raiz `/home/clawd/repos/ze_claude`, ignorar salvo se impactarem diretamente a tarefa.

