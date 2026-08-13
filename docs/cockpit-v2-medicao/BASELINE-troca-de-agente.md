# Baseline da troca de agente — 12/08

> A régua de aprovação da caça ao "pisca". Quem mexer no caminho
> **tropa → conversa** roda `troca-de-agente.py` ANTES de editar, compara faixa
> contra faixa e mediana contra mediana, e atualiza esta tabela.

## Por que existe

O Rica reclamou por áudio e mandou dois vídeos do iPhone: *"ainda pisca, cheio de
bugzinho"*. Extraídos a 30 quadros/s, a troca de agente passava por cinco estados
em pouco mais de um segundo.

Este arquivo nasceu de um erro: na primeira rodada eu medi o "antes" **uma vez**,
consertei e publiquei, e só então colhi quatro amostras do "depois". Ao reiniciar
a unit destruí o único estado que responderia se tinha melhorado — a régua que o
Pavan tinha cravado ficou indecidível. Baseline se colhe antes, com repetição, e
num caminho que sobrevive ao reboot.

## Como medir

```bash
python3 docs/cockpit-v2-medicao/troca-de-agente.py 3008 6 "rotulo"
```

Três cuidados que mudam o resultado:

- **Derrubar o dev da 3009 antes.** Ele disputa as 2 vCPU e desloca a faixa
  inteira. Matar pela porta (`ss -lntpH 'sport = :3009'`), nunca `pkill -f` com
  padrão amplo — o padrão casa com o próprio shell.
- **Contexto novo a cada repetição** (a bancada já faz): o cache de stream segura
  a conversa por 30s, e a segunda visita mede o cache, não a troca.
- **Não medir no slug `daniel`.** É uma sessão viva; a conversa cresce entre as
  amostras. Para o lado servidor, usar um agente offline.

## Estado em 12/08, produção 3008, após `166c235`

6 repetições · load ~3–4 em 2 vCPU · ~1,6 GB em swap · dev da 3009 derrubado.

| marco | faixa | mediana |
|---|---|---|
| item acende | 86–223ms | **99** |
| URL commita | 343–689ms | **398** |
| 1ª mensagem pintada | 900–2844ms | **1041** |

**O branco que o Rica vê é a distância entre os dois últimos: mediana ~640ms.**
A amostra de 2844ms é cauda — 6 repetições não a caracterizam, e ela não deve
sozinha reprovar nem aprovar nada.

### Lado servidor, à parte

`python3 docs/cockpit-v2-medicao/replay-do-servidor.py hiro 3 300` — agente
offline, `Accept-Encoding: identity`:

| limite | payload | eventos | `replay-end` |
|---|---|---|---|
| 30 | 100,7 KB | 32 | 85–252ms |
| 100 | 320,1 KB | 102 | 127–715ms |
| 300 | **790,4 KB** | 240 | **338–902ms** |

O primeiro byte fica em 33–272ms e **não** correlaciona com o limite: o custo do
teto não está em achar a cauda, está em emitir os eventos. Medido em
`127.0.0.1`; o Rica recebe isso pela Tailscale, no 5G, a cada troca.

**O 300 não se toca** — é ordem do Rica e passa pelo Pavan. A direção cravada por
ele é outra: teto de histórico e tamanho do primeiro lote pintado não precisam
ser o mesmo número.

## Picote do rótulo do motor — 12/08, `5323982` + `8c1cb54`

Régua: `picote-do-rotulo-do-motor.py`. 4 repetições por par, 3008, dev derrubado.

O rótulo do composer pintava em duas etapas: nascia sem o nível de esforço, e o
nível chegava no `/painel` (Claude 52ms, **Codex 1,77s**). Duas causas somadas —
a rota não repassava o esforço que já tinha, e o cliente dava o veredito de "não
tem controle" antes da resposta, o que fazia o rótulo nascer `div` de texto e
virar botão.

| par | antes | depois |
|---|---|---|
| daniel→pavan (Claude) | `'Opus'` → `'Opus extra alto ⌄'`, 187–296ms | `'Opus ⌄'` → `'Opus extra alto ⌄'`, 280–385ms |
| daniel→tara (Codex) | *não medido com a sonda correta* | **uma etapa em 4/4** |

Prova sem browser, no HTML servido: tara `'GPT-5.6 Terra máximo ⌄'`, hiro
`'K3 alto ⌄'`, pavan `'Opus ⌄'`.

Três coisas que este quadro NÃO deixa dizer:

- **No Claude o intervalo não caiu — subiu ~50ms** (mediana 275 → 328). O que
  mudou lá foi a natureza do pulo: antes trocavam forma, fonte, cor e conteúdo;
  agora troca só a palavra do nível. Chamar isso de melhora de tempo seria
  mentira; a melhora é de amplitude, e ela não está medida em número.
- **O antes do par Codex não existe com a sonda correta.** Rodei o build antes
  de colher — o mesmo erro de sequência de manhã, agora com o par que prova a
  metade do servidor. O "uma etapa em 4/4" fica valendo contra o HTML servido,
  não contra um antes medido.
- **O Claude é o caso comum, não a exceção**: a maioria da tropa é Claude, e lá
  o picote de ~328ms continua em 4/4.

## O branco morreu — 12/08, pré-aquecimento no toque

Régua: a mesma `troca-de-agente.py`. O vão que estava "em aberto" tinha dono, e
era a ORDEM dos eventos: o `EventSource` da conversa nascia dentro do
`FeedDaConversa`, que só monta depois da navegação commitar. Servidor e cliente
em série. Agora o toque abre o stream (`lib/preaquece-conversa.ts`) e a
navegação corre por cima dele.

Medido em processos igualmente novos, alternados, duas rodadas de 5 — a 3011
serve o build sem a mudança, a 3010 o build com ela. Medianas em ms:

| | item acende | URL commita | 1ª mensagem | branco |
|---|---|---|---|---|
| sem (3011) | 63 / 70 | 214 / 223 | 694 / 701 | **~478** |
| com (3010) | 76 / 60 | 685 / 593 | 685 / 593 | **0** |

**A primeira mensagem passou a pintar no MESMO quadro do commit, em 22/22
repetições.** O que o Rica via como salto — tela anterior, branco, conversa —
virou tela anterior, conversa.

### O que isso custou, e onde o custo mora

**O commit da URL atrasou ~420ms** (218 → 640). O custo é do SERVIDOR, não do
browser, e está isolado: o RSC de `/agente/[slug]` responde em **0,40–0,44s**
sozinho e em **0,65–1,13s** com um replay SSE em curso (3 amostras cada, curl
direto). O Next faz o proxy do SSE no mesmo processo Node — o replay de 790 KB
disputa o event loop com a navegação.

O saldo é o que a tabela mostra: a conversa chega no mesmo instante ou antes, e
o branco sai. Mas dizer que "ficou mais rápido" seria mentira — o que mudou foi
a ordem, e o total ficou igual.

**Não custou conexão.** `conta-eventsources.py` nos dois builds: 3 construídas,
2 abertas, URLs idênticas. A chave do cache bate — é o que o teste
`lib/preaquece-conversa.test.ts` prende.

### As duas alavancas que sobraram, com número

- **O RSC custa 0,42s antes de qualquer disputa.** A rota espera a frota inteira
  (o mesmo `fetchFleet` de 0,4–10,5s do `rede-de-navegacao.ts`). É o piso do
  commit hoje, e não tem nada a ver com o feed.
- **O primeiro lote não precisa ser o teto de histórico.** Direção já cravada
  pelo Rica nesta mesma régua. Um replay menor no primeiro lote encurtaria a
  disputa acima sem tocar no teto de 300.

## Conexões SSE — sem defeito, medido

`conta-eventsources.py` instrumenta `window.EventSource` antes dos scripts da
página (a lista do DevTools não responde "quantas ficam vivas"). Numa troca, na
produção: 2 conexões na tela, 3 durante a troca, e a anterior **fecha sozinha**
passados os 30s do TTL ocioso. Uma por agente, sem vazamento.

Os "7 EventSources" vistos no dev eram StrictMode + Fast Refresh recriando o Map
do cache. E a duplicidade de chave suspeitada no código não existe em runtime:
`components/feed/feed-ao-vivo.tsx` é órfão — nunca importado.
