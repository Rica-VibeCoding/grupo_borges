# scripts/prova — o que só o navegador prova

Provas de comportamento que a suíte não alcança. `node --test` não tem DOM: ciclo
de vida de efeito do React, foco, teclado e o que a tela realmente mostra só se
verificam em navegador de verdade.

Não substituem teste. **Régua de origem** (`daniel/AGENTS.md`): defeito tem teste
que falha antes do fix; onde não cabe teste automatizado, define-se na entrada o
comando que prova e roda-se ele no fim. Isto é esse comando.

## Rodar

O dev da 3009 precisa estar de pé (skill `subir-cockpit` — **nunca** `next dev`
genérico, derruba o cockpit do Rica na 3007).

```bash
cd apps/cockpit && python3 scripts/prova/retentativa-painel.py
```

Cada script imprime `✓` por metade verificada e estoura `AssertionError` na que
falhar. Sai 0 só quando tudo passa.

## Duas regras que valem para toda prova nova

**1. Falha se simula NO CLIENTE, nunca derrubando serviço.**

```python
pag.route("**/painel", lambda r: r.fulfill(status=503, body='{}'))
```

A `cockpit-api` é unit transiente: `systemctl --user stop` **apaga a unit** e o
`start` seguinte responde `Unit not found` (07/08 — a API do Rica ficou fora e
quem religou foi ele). Interceptar também impede o teste de despachar de verdade
contra a sessão tmux de um agente real. Detalhe em
`ze-shared/memory/shared_quem_matou_sobe.md`.

**2. `time.sleep()` não existe aqui — use `pag.wait_for_timeout(ms)`.**

No Playwright *sync* os handlers de `page.route` rodam no processo Python, e o
`sleep` bloqueia o loop que os despacha: a requisição interceptada fica pendurada
e o relógio do app não anda. Isso já fez um conserto **correto** ser lido como
falho por duas corridas — o sinal foi o par vermelho/verde dar exatamente o mesmo
número. Fix que não move a agulha nem um pouco = desconfiar da medição antes da
hipótese.

## O que existe

| script | prova |
|---|---|
| `retentativa-painel.py` | Painel fora do ar volta sozinho; backoff cresce (2s/4s/8s) e para ao fechar a gaveta. Bug `940d5c07`, commit `783b2be`. |
| `composer-retomada.py` | "Tentar de novo" reenvia o texto pendurado sem comer o que está no campo. Bug `307c4624`, commit `c4ab92f`. |
| `bolha-da-fila.py` | Mensagem enviada com o agente em turno vira bolha na hora, marcada "na fila"; a marca cai na drenagem e não nasce bolha duplicada. Bug `e615c350`. |

**Exceção à regra 1 em `bolha-da-fila.py`:** ele despacha DE VERDADE, sem
interceptar. O que se mede é o caminho inteiro CLI → JSONL → SSE → feed, e um
`fulfill` provaria só o desenho. O alvo é o `canario` (`agents.yaml`), agente
descartável com casa própria — nunca um agente produtivo.

**Terceira regra, aprendida nesse mesmo bug:** *espere o FATO, não o relógio.*
Duas corridas erraram por cronômetro — uma leu como sucesso uma bolha que era o
eco comum (o agente já tinha saído do turno), outra leu como defeito uma marca
legítima (o turno ainda rodava). O laço espera a linha no JSONL.

Screenshot **não** é versionado — é artefato de corrida e pesa. O que se versiona
é o script que sabe tirá-lo de novo. Sai em `/home/clawd/provas/<nome>/`, ou onde
`PROVA_SAIDA` apontar.

## Dependência

`playwright` Python + chromium, já instalados na VPS (`~/.local/lib/python3.12`).
Fora das dependências do app de propósito: não são precisos para build nem para
`npm test`, e adicioná-los ao `package.json` puxaria browser no `pnpm install` de
quem só quer subir o cockpit.
