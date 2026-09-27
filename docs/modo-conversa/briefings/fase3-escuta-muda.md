# Fase 3 — escuta que emudece no iPhone (cadeira `ui`, logo depois do toque, antes dos gestos)

**Sintoma (Rica, 27/09 ~05:00 UTC, iPhone, Esfera, agente `daniel`):** algumas falas passaram (vários
`transcription 200` + `input 200` em `/tmp/cockpit-api.log` da VPS). Depois de uma resposta falada, a tela
ficou em "Pode falar" e **nenhum POST de `transcription` chegou mais**: o detector não disparou. "Ele não
trava, ele não me ouve."

**Suspeita (não provada):** o iOS interrompe o áudio de captura quando a voz do Zé toca (`speechSynthesis`
em `sons-locais.ts`, `<audio>`/`AudioContext` da fila de voz). O `AudioContext` do detector pode ficar
`suspended`/`interrupted` ou a faixa do microfone `muted`, e o código só ouve `ended`
(`use-detector-de-fala.ts:67`): nada detecta o silêncio forçado.

**O que fazer:**
1. Reproduzir antes do conserto (regra da casa): teste puro do que decide "a escuta caiu" e, no E2E, simular
   `AudioContext` suspenso / faixa `mute` depois de uma resposta falada.
2. Vigiar `statechange` do `AudioContext` do detector e `mute`/`unmute` da faixa; ao sair de `falando`
   para `ouvindo`, conferir que o contexto está `running` e o nível chega (`leNivel`). Caiu → `resume()`;
   se não voltar em ~1 s, reabrir o microfone; se não der, erro que pede ação ("toque para voltar a ouvir").
3. Medir no relato o que o E2E NÃO prova: o comportamento real só se confirma no iPhone.

Mesmos limites e fecho do `fase3-toque.md`. Última linha: `FIM-DA-ESCUTA`.

**Junto, caso de borda do toque (revisão do 43b23a4):** parar esperando o Zé ANTES da resposta não freia; o
turno velho segue e a marca `zeDescartado` atravessa o recomeço. Se ele recomeçar e perguntar outra coisa
logo, o Claude Code enfileira e emenda o turno novo no velho — o stream pode não mostrar o fim do velho, e a
resposta NOVA sair calada como se fosse descartada. Cubra no E2E: parar antes da resposta → recomeçar →
nova pergunta → a resposta nova tem de ser falada.
