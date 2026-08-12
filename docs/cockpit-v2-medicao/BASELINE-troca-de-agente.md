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

## Em aberto

**~540ms sem dono.** A conexão só abre depois do commit (398ms) e o primeiro byte
chega em 33–272ms, o que põe a primeira mensagem por volta de 500ms. Ela chega em
1041. A diferença não está explicada e não deve ser preenchida por especulação.

## Conexões SSE — sem defeito, medido

`conta-eventsources.py` instrumenta `window.EventSource` antes dos scripts da
página (a lista do DevTools não responde "quantas ficam vivas"). Numa troca, na
produção: 2 conexões na tela, 3 durante a troca, e a anterior **fecha sozinha**
passados os 30s do TTL ocioso. Uma por agente, sem vazamento.

Os "7 EventSources" vistos no dev eram StrictMode + Fast Refresh recriando o Map
do cache. E a duplicidade de chave suspeitada no código não existe em runtime:
`components/feed/feed-ao-vivo.tsx` é órfão — nunca importado.
