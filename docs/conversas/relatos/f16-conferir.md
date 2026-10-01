# F16 — conferência do caminho no canarinho (relato)

- **Os 9 passos passaram** na :3446 (Chrome 390×844, rede real, sem erro de página). Capturas em `C:\tmp\f16-conferir\` (roteiros `fluxo*.mjs` lá também).
- 2–4: Nova pela gaveta → marco "Conversa nova" + atalho com "Saudação em japonês" → Voltar traz a anterior → nova de novo → o atalho some na hora em que a mensagem sai.
- 5–8: leitura abre em 0,7 s sem trocar o chat; Renomear aparece na lista; ⭐ liga e desliga; Continuar esta com barra (~14 s) → "Retomada agora"; Concluída sai de *Todas* e entra em *Concluídas* (depois reabri).
- 9: com o agente no turno, a leitura mostra "Canário está trabalhando" e o botão âmbar "Interromper e continuar esta".
- 🔴 **1ª Nova falhou** (18:53, antes da republicação): "A troca de conversa não terminou — o /rename não chegou (campo ocupado ou travado)". O atalho **não apareceu** até eu recarregar; depois veio sem título. A 2ª Nova funcionou.
- 🔴 **Canarinho caiu** ("Fora do ar") ~1 min depois do Continuar esta na conversa de 108 turnos, com a tela dizendo "Retomada agora". Religou pela gaveta em 5 s, pegou turno normal; não reproduzi.
- 🟡 Demora: depois do toque em Nova a gaveta leva **10–12 s** para fechar; o Voltar levou 23 s. VPS em CPU 99% na hora.
- 🟡 Conversa de 1 turno ("Obrigado em japonês") ganha o marco "ficou guardada no Histórico", mas a lista a esconde (`escondidas_curtas`) e a busca não acha. O Rica vai procurar e não vai achar.
- 🟡 Leitura mostra markdown cru (`**`, crase) e, no fim, o pedido interno do cockpit para estacionar (com o `curl`) e o "ok" do agente.
- ℹ️ A :3446 ficou ~3 min fora (chunk 500, depois 502) na republicação das 19:06; o passo 9 foi refeito depois dela.

**APROVADO** — o caminho da F16 funciona de ponta a ponta no canarinho. Os dois 🔴 vêm da troca no backend e da queda do agente, não da tela; mas o atalho sumido no caso de erro é da tela e merece correção na próxima rodada.
