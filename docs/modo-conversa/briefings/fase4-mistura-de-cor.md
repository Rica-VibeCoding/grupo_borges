# Fase 4 — o pensando mistura a cor de quem ouve com a de quem fala (cadeira `ui`)

Base: main `5cdf43e` (inclui o conserto do microfone). Depois do briefing das frases de apoio, mesma cadeira.

## O que o Rica pediu (29/09, testando ao vivo)
Hoje a esfera troca de cor por estado: dourado ouvindo (`--ck-state-attention`), roxo pensando
(`--ck-state-thinking`), azul (anil) falando (`--ck-state-running`) — `coresDaEsfera()` em `esfera-estado.ts`,
paleta lida de `app/globals.css` em `esfera-conversa.tsx` (`TOKENS`/`leCoresDoTema`). Ele gosta do dourado na
entrada e do azul no final, mas quer trocar o roxo fixo do pensando por uma **mistura entre as duas**: como se a
sua voz (dourado) estivesse virando a resposta dele (azul) enquanto ele pensa.

## Pedido
- Nos estados de pensar (`transcrevendo`, `esperandoZe`, `trabalhando` — os três que hoje retornam corpo `'pensa'`
  em `coresDaEsfera`), o corpo da esfera passa a ser a cor **interpolada entre `voce` e `ze`**, não mais o tom
  `pensa`. A `borda` de `trabalhando` já é `'ze'`; mantenha.
- A mistura evolui: comece mais perto do dourado (logo que ele solta a fala) e termine mais perto do azul (perto de
  `falando`). Se não der pra medir "quão perto do fim" com o que já existe, um peso fixo (~50/50) já atende — não
  invente sinal novo sem checar antes comigo ou registrar a limitação no relato.
- `--ck-state-thinking` (o roxo) fica livre para outros usos do cockpit fora da esfera de voz — não mexer no token
  em si, só em como a esfera de voz o usa.
- Vale para a Esfera (`esfera-conversa.tsx`/`esfera-estado.ts`) e a Moldura (`moldura-conversa.tsx`/
  `moldura-estado.ts`), que têm a mesma estrutura de Tom/cor — confira as duas.

## Onde
`coresDaEsfera`/`coresDaMoldura` (nomes conforme o arquivo) devolvem hoje `{ corpo: Tom, brilho, borda: Tom }`.
Para permitir mistura, o tipo pode virar `{ corpo: Tom | { entre: [Tom, Tom]; peso: number }, brilho, borda: Tom }`
(ou equivalente mais simples que você achar — menor diff que resolve). Quem consome (`esfera-conversa.tsx`,
`moldura-conversa.tsx`, o `data-tom` do modo sem WebGL) precisa saber misturar duas cores lidas de `leCoresDoTema`.
O modo sem WebGL (`data-tom`) não tem `color-mix` fácil por atributo — se for esse o caminho, pode precisar de uma
classe/variável CSS nova; mantenha simples.

## Regras
- Teste vermelho antes: para os três estados de pensar, o corpo não é mais `'pensa'` — é a mistura.
- UI se testa clicando na tela (`browser-harness`): abrir a voz, falar, ver a esfera dourada, depois pensando com a
  cor misturada (nem puro dourado nem puro azul), depois azul falando. Sem WebGL (modo reserva) também.
- Não reinicie o dev 3009 sem parar antes. Proibido: VPS, commit, agente real além do Canário. Teto 30%.

## Fecha quando
`npm test` e `type-check` verdes, com números; relato em `relatos/fase4-ui.md` (seção nova, com o que decidiu sobre
o peso da mistura). Última linha sozinha: `FIM-DA-MISTURA`.
