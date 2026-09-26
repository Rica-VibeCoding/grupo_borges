# Fase 1 — trilha LÓGICA (cadeira `logica`)

Plano guia: `docs/cockpit-v2-modo-conversa-PLANO.md` (leia inteiro antes). Contrato: `apps/cockpit/lib/conversa/tipos.ts`.

## O que entregar
- `apps/cockpit/lib/conversa/maquina.ts`: `inicial(): Conversa` e `avanca` com o tipo `Avanca` do contrato. Pura: sem timer, sem fetch, sem DOM. O relógio entra por `agora`.
- Ciclo: `parado → ouvindo → transcrevendo → esperandoZe → falando → ouvindo`. Cada transição devolve os efeitos que a tela executa (`ligarDetector`, `transcrever`, `enviar`, `falar`...).
- Meio-duplex: ao entrar em `falando`, `desligarDetector`; ao sair, `ligarDetector`.
- Relógio da espera (movido pelo evento `tique`): `tocarTique` ao enviar; `falarPonte` uma vez por turno se nenhum `textoDoZe` chegou em `TEMPOS.ponte`; `avisarDemora` uma vez em `TEMPOS.avisoDemora`.
- Erros do `MotivoDeErro` levam a `erro` com `avisarErro`. Decida e documente como sai de cada um (ex.: `transcricaoVazia` volta a ouvir sem incomodar).
- `comecar` repetido fora de `parado` não produz efeito nenhum (a fase 0 mediu: 4 toques = 4 detectores, cada frase enviada 4×).
- `apps/cockpit/lib/conversa/maquina.test.ts` com `node:test`, no estilo dos `lib/*.test.ts`. Teste antes do código.

## Regras
- Pode estender `Conversa` com campos seus. Mudar `Estado`, `Evento`, `Efeito` ou `Avanca`: pare e escreva no relato o porquê — o contrato é compartilhado com a cadeira `tela`.
- NÃO tocar: `package.json` (dono: `tela`), nada fora de `apps/cockpit/lib/conversa/`. A outra cadeira trabalha no MESMO clone, ao mesmo tempo.
- Rodar: `node --test apps/cockpit/lib/conversa/*.test.ts` (sem dependência instalada, os testes só podem importar do próprio `lib/conversa/` e de `node:`).
- Não commitar. Relato em `docs/modo-conversa/relatos/fase1-logica.md`: o que fez, saída dos testes, decisões, dúvidas.
- Se enxergar furo no contrato ou neste briefing, o seu caminho vale: você está com o código na frente. Escreva no relato.
