# F13 — Tela: a experiência da troca no chat (cadeira `tela`)

Carregue a skill `frontend-design`. Código no `main`. Você não commita. Relato em
`docs/conversas/relatos/f13-tela.md`, até 12 linhas. A cadeira `api` faz a F13 de API ao
mesmo tempo; o contrato está abaixo. Teste contra dublê do stream; a prova real é minha.

## O que o Rica viu (01/10, 03:01 BRT, captura no Omarchy:
`~/Pictures/screenshot-2026-10-01_03-01-30.png`)

Retomou uma conversa no canarinho. A troca deu certo no servidor, mas o chat continuou
mostrando a conversa que saiu, terminando num bloco enorme `[cockpit] Vou fechar esta
conversa… curl -sS -X POST …` como se fosse fala dele, e um "ok". Nada dizia que a conversa
tinha mudado. Ordem dele: "a UI/UX ali tem que ter uma prática boa mesmo, para dar uma
experiência boa para quem está fazendo a troca."

## Contrato da API (F13, em construção)

- Stream emite `conversa-trocada {session_id, de, motivo: "retomar"|"nova", titulo, nota,
  briefing}` e, em seguida, o replay do histórico da conversa nova.
- Mensagens com `origem: "cockpit"` são o pedido de estacionar e o "ok" do agente.

## Entrega

- **No chat:** a troca vira um marco claro (de qual conversa para qual, com título e nota da
  retomada, e o briefing de retorno quando houver, recolhido). A conversa que saiu não fica
  na tela como se fosse a atual. Durante a espera (o `/operacao` da gaveta), o chat mostra que
  está trocando, sem parecer travado.
- **Mensagens `origem: "cockpit"`:** uma linha discreta ("Cockpit pediu para anotar onde
  parou"), expansível, nunca a bolha do Rica.
- **O Histórico:** releia a lista e o cartão "Em uso agora" com olho de quem troca de conversa
  no celular e melhore o que achar: o que a nota e o título mostram, como a conversa
  retomada se destaca, o caminho de volta ao chat depois da troca.

## Pronto

`test` e `type-check` verdes contra a base (1 falha antiga em
`configuracao-operacional.test.ts:32`), e capturas 390×844 em `/tmp/f13/`: chat durante a
troca, chat depois (Retomar e Nova), a linha do cockpit fechada e aberta, e o Histórico.

Viu furo? Escreva no relato; seu caminho vale.
