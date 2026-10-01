# F17 — Tela: arestas da conferência (relato)

- **Voltar com erro** (`app/agente/[slug]/voltar-pra-anterior.tsx`, `feed-da-conversa.tsx`): a troca `falhou` não esconde mais o atalho (só `trocando`/`pronta` contam). A lista é relida a cada passo da espera (`chave` = sessão do stream + fase), não só no aviso do stream — que a Nova com /rename falho nunca manda.
- Sem marco, o primeiro turno é contado a partir da hora em que a lista viu a conversa vazia (`temPrimeiroTurno` aceita `{ emMs }`): a conversa velha que segue no stream não esconde o atalho; a primeira fala do Rica esconde. Relida ainda vazia, vale a primeira hora.
- **Título**: o da lista; se a anterior não está em *Todas* (curta ou concluída), vem do `/leitura` dela. Título já achado não pisca entre releituras.
- **Markdown na leitura** (`leitura-do-historico.tsx`): fala do agente pelo `AssistantMarkdown` do feed, com prop nova `leve` (`components/renderers/markdown.tsx`): código num `pre` simples, sem cabeçalho nem copiar; imagem vira só o texto alternativo. Fala do Rica segue texto puro, como no feed.
- Pulso dourado não tocado.
- **Provas:** `type-check` verde antes e depois. `test` base 1604/1614 → depois 1605/1615 (+1 do caso sem marco em `conversa-trocada.test.ts`); as mesmas 9 falhas antigas (8 `use-detector-de-fala`, 1 `configuracao-operacional`).
- **Navegador** (Chrome 390×844, dev 3009, API falsa `C:\tmp\f17\fake-api.mjs` com Nova que dá erro de /rename sem avisar o stream e anterior fora da lista): atalho aberto junto do aviso de erro, com "Webhook do Asaas caindo no retry" embaixo; some com a primeira fala. Leitura com negrito, crase, lista, código e link renderizados. Sem erro de página. Capturas: `C:\tmp\f17\1-nova-falhou.png`, `2-leitura-markdown.png`; roteiro `fluxo.mjs`.
- **Não testado ao vivo:** VPS/canarinho. Dev e API falsa derrubados no fim.
- **Anotar:** `feed-da-conversa.tsx` em 408 linhas (era 407), segue acima do teto de 300.
- **Não fiz:** commit (briefing), build/publicação. Ping: o briefing não traz casa (`-L`) nem sessão (`-t`) — **ping não enviado**.
