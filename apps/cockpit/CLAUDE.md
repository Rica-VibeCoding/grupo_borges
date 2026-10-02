# apps/cockpit — Cockpit v2

Camada de apresentação nova, contra o mesmo back FastAPI. Dev na **3009**,
produção deste app na **3008** (`cockpit-v2.service`, na `borges` — a VPS
Oracle). O cockpit **v1** é `apps/web`: **congelado** e fora do ar desde a mudança
pra `borges` — não recebe commit.

O Rica não alcança as portas da `borges` direto: elas escutam em `127.0.0.1` e
quem publica é o `tailscale serve`, com TLS no nome do node. **Passar o IP da
Tailscale quebra** — a URL é sempre `https://borges.tailfe77db.ts.net:<porta>`,
`:3445`→API 8002, **`:3446`→3008, a única do Rica**, `:3447`→3011 (preview de
branch `ideia/*`, só quando há uma em teste).

⚠️ **A `:3444` (dev) foi retirada da tailnet em 08/08, a pedido dele.** Ele não
olha mais trabalho em andamento: só vê o que está publicado na `:3446`. O dev
continua na 3009, agora só em `127.0.0.1` — quem valida é você, por
curl. Mandar `:3444` pra ele é mandar URL morta. Exceção: no notebook dele
(Omarchy) o dev roda na máquina que ele usa, e aí `localhost:3009` abre direto,
com a API vindo da `:3445` (`docs/cockpit-v2-stack.md` §10).

⚠️ Dev e produção **não podem dividir o `.next`** — dois processos escrevendo no
mesmo diretório é o que fazia o Turbopack servir CSS velho, e um `rm -rf .next`
pra destravar derruba a produção (aconteceu em 04/08, 7 minutos de 500 nos chunks
com o HTML ainda respondendo 200). O dev sobe com `COCKPIT_DIST_DIR=.next-dev`.

## Antes de escrever a primeira linha

**A tela não é um chat, é um log de execução que às vezes conversa.** 82% dos
blocos são `tool_use`/`tool_result`, medido. Quem trata a bolha de mensagem como
peça central está polindo 18% da tela.

## Mexeu em X → leia Y

| Você vai... | Leia primeiro |
|---|---|
| escolher versão, porta, configuração de build | `../../docs/cockpit-v2-stack.md` |
| tocar cor, espaço, tipografia, estado visual | `../../docs/cockpit-v2-estetica.md` |
| renderizar payload, mexer no feed, no envio ou no SSE | `../../docs/cockpit-v2-data-contract.md` |
| tocar no composer, em altura, respiro ou teclado | `../../docs/cockpit-v2-composer.md` |
| criar arquivo, ou não sabe se o arquivo é seu | `../../docs/cockpit-v2-ownership.md` |
| mexer em `packages/cockpit-core` | `../../packages/cockpit-core/CIRURGIAS.md` |
| retomar depois de `/clear`, saber o que está no ar | `../../docs/cockpit-v2-ESTADO.md` |
| entender por que o plano é este (histórico) | `../../docs/cockpit-v2-playbook.md` |

## Seis regras que não se negociam

1. **Cor só em `app/globals.css`.** Nenhum hex, `rgb()`, `oklch()`, nome de cor
   ou `bg-[#...]` em componente — componente pinta só com `var(--ck-*)`, inline
   ou em classe. É o que permite "põe no verde" mudar um lugar.
2. **SSE nunca passa pelo gzip.** O `compress: true` só é seguro porque todo
   stream da API tem route handler em `app/api/**` com `no-transform`
   (`lib/repasse-sse.ts`); stream novo sem handler morre em silêncio — replay em
   rajada e nenhum heartbeat. Parece bug de protocolo, é gzip (stack §4).
3. **Campo de entrada nunca abaixo de 16px** (`--ck-text-md`). Abaixo disso o
   Safari dá zoom ao focar e o layout salta.
4. **Teto de 300 linhas por arquivo.** Passou, está fazendo duas coisas.
5. **Nunca `next dev` genérico nem `pkill next`** — na `borges`, derruba a
   produção na 3008, que é o mesmo `next-server`. Use a skill `subir-cockpit`.
6. **Terminou, publica — sem perguntar.** Ordem do Rica em 08/08: commit não é
   entrega, ele só vê o que está na 3008. Build e republicação fazem parte da
   tarefa, não são um segundo pedido. Publicar é `git pull --rebase` + `git push`
   e depois **`scripts/publicar-cockpit.sh`** — o mesmo comando na `borges` e no
   notebook (de lá ele entra por SSH e roda na `borges`, liberado pelo Rica em
   02/10). Ele compila o `origin/main` num worktree próprio, prova o estágio numa
   porta reserva, troca a pasta, reinicia e volta sozinho se a 3008 não responder
   (roteiro no `docs/cockpit-v2-stack.md` §2). Nada de `next build` na mão na
   árvore compartilhada: publica trabalho pela metade e derruba os chunks.
   Com a `:3444` fora do ar, **publicar é o único jeito de ele ver** — não existe
   mais "ele acompanha pelo dev".

## Skills daqui

`subir-cockpit` · `novo-renderer` · `mexer-na-pele` · `checar-paridade`

## Onde as coisas estão

- `app/globals.css` — tokens. §A pele (Daniel), §B esqueleto (Pavan); mapa das
  seções com cor na §2 da estética
- `components/shell/` — AppShell, tropa (sidebar), composer, seletores de motor e conta
- `components/feed/` — o feed: lista, bolhas, grupo de passos, linha viva, marcos
- `components/renderers/` — o corpo de cada execução aberta (shell, diff, fetch…);
  várias famílias caem no mesmo corpo
- `components/gaveta/` — gaveta do agente e painel de Conversas
- `components/conversa/` — modo conversa (voz em tempo real)
- `components/ui/` — primitivas do shadcn
- `@grupo_borges/cockpit-core` — lógica pura, sem React. Consumido como source
- `../../fixtures/cockpit-v2/familias/` — 52 famílias reais. Renderer se escreve
  contra elas, nunca contra payload imaginado
