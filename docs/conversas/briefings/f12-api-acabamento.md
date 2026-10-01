# F12 — API: acabamento depois da F11 (cadeira `api`)

Leia `docs/conversas/relatos/f11.md` (a cadeira `teste` percorreu tudo na `:3446`, APROVADO com
furos). Código no `main` (`df4c413`). Você não commita. Relato em
`docs/conversas/relatos/f12-api.md`, até 12 linhas, `pytest` contra a base (870 ok + 3 falhas
de ambiente + 2 xfailed).

## Três furos medidos pela `teste` (capturas no Omarchy, `/tmp/f11/`)

1. **Bolha do `/clear` na conversa nova.** Depois de toda Nova, a conversa nova abre com
   `SLASH: /CLEAR <título da anterior>` + `<system-reminder>` no feed (`84-feed-nova.png`), e o
   agente lê isso: a nota que ele escreveu depois citava o resíduo. Descubra de onde vem
   (JSONL da conversa nova do canarinho em `~/.claude/projects/-home-clawd-repos-ze-claude-canario/`
   na VPS: leia por `ssh clawd@borges.tailfe77db.ts.net`, sem escrever nada lá) e se é do CC
   (vale para todo agente) ou do motor DeepSeek. Conserte do lado do cockpit: o feed não
   mostra, e o agente não deve receber o título velho como pedido.
2. **🔒 falso duas trocas atrás.** A → B → C: a A fica "Em uso em outro lugar" por até 2 min,
   sem ninguém com ela aberta (`H1-travada-aberta.png`). Só a última `deixada` é lembrada.
3. **Horário do briefing em UTC.** O agente recebe "05:16", a tela e o Rica vivem em BRT
   ("02:16"). Datar em `America/Sao_Paulo`.

Viu furo? Escreva no relato; seu caminho vale.
