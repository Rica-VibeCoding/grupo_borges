# F1 — Medições (cadeira `api`)

Contexto do projeto: `docs/conversas/PLANO.md` — leia só "O pedido", "Decisões" e a seção F1.
Pesquisa de apoio: `docs/conversas/pesquisa.md` §1.5, §1.6, §1.8 e §6 (só essas).

**Nada de código de produto; no repo, só o relato.** As sondas moram numa pasta descartável
`~/sonda-conversas`.
Você não commita. O relato vai em `docs/conversas/relatos/f1.md` (até 15 linhas + anexos em
`/tmp/f1/`).

## Como a frota sobe o `claude` (é isso que a medição tem de imitar)

`ze_claude/ze-shared/scripts/subir-frota.sh:649` (cópia lida na VPS):
`claude --dangerously-skip-permissions --channels plugin:telegram@claude-plugins-official ${FROTA_FLAGS_EXTRA}`
— **sem prompt na linha de comando**, dentro de um tmux. O Retomar vai trocar o `--continue` de
hoje por `--resume <id>`. Logo depois do boot, o script **digita `/rename <nome>` na linha**
pelo tmux. Se houver diálogo aberto nessa hora, essas teclas caem dentro dele — anote o que
aconteceria.

## M1 — o diálogo "Resume from summary"

A doc (`code.claude.com/docs/en/sessions`): conversa com mais de 100 mil tokens, parada há mais
de 1 h, abre um diálogo antes da primeira mensagem — "Resume from summary", "Resume full session
as-is", "Don't ask me again".

- Candidatas no Omarchy (conversas reais do Rica, **não alterar**): `~/.claude/projects/
  -home-ricardo-Projetos-Omarchy/a3322b6b-…jsonl` (6,5 MB, 30/09) e `bf099726-…jsonl` (19 MB).
  Confirme pelo `usage` da última resposta que passa de 100 mil tokens.
- Rode **com `--fork-session`**, no cwd original da conversa, num `tmux -L sonda`, com
  `--dangerously-skip-permissions` e sem prompt. **Não mande mensagem nenhuma.**
- Responder: o diálogo aparece? Captura do pane. Quais teclas escolhem "Resume full session
  as-is"? O que acontece se chegar `/rename x` + Enter com o diálogo aberto?
- "Don't ask me again": em qual arquivo e chave grava? Diff do `~/.claude.json` antes e depois
  (e do `~/.claude/settings.json`). **Depois de medir, desfaça só aquela chave** — não restaure
  o arquivo inteiro de backup, outras sessões escrevem nele.
- No fim: o JSONL do fork vai para a lixeira (`gio trash`), se tiver sido criado. Diga se foi.

## M2 — `/clear <nome>`

Numa conversa nova em `~/sonda-conversas` (uma mensagem curta basta): `/clear sonda-titulo`.
Qual JSONL recebe a entrada `custom-title`? A conversa nova nasce sem nome? Mostre as linhas.

## M3 — gancho `SessionStart` com `source: resume`

Gancho só no **projeto** (`~/sonda-conversas/.claude/settings.json`), nunca no global. Ele grava
o JSON de entrada num arquivo e devolve `additionalContext` com uma palavra-senha.

- Dispara no `claude --resume <id>` da largada, sem prompt? Qual `source` chega?
- O `additionalContext` chega ao modelo? Peça para ele repetir a senha.
- Dispara com `--continue`? Com qual `source`?
- Anote se os campos `seconds_since_last_response` e `context_tokens` vieram.

## Pronto

Os 3 itens respondidos com comando + saída real (ou captura). O que não deu para medir fica
escrito como "não medido" com o motivo — não deduza. Achou furo no plano? Escreva no relato; seu
caminho vale, você está com a máquina na frente e eu não.
