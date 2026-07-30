# apps/cockpit — Cockpit v2

Camada de apresentação nova, contra o mesmo back FastAPI. Dev na **3008**.
O cockpit **atual** é `apps/web` na 3007 e está **congelado** — não recebe commit.

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
| criar arquivo, ou não sabe se o arquivo é seu | `../../docs/cockpit-v2-ownership.md` |
| mexer em `packages/cockpit-core` | `../../packages/cockpit-core/CIRURGIAS.md` |
| entender por que o plano é este | `../../docs/cockpit-v2-playbook.md` |

## Cinco regras que não se negociam

1. **Cor só em `app/globals.css`.** Nenhum hex, `rgb()`, `oklch()`, `bg-[#...]`
   ou cor inline em componente. É o que permite "põe no verde" mudar um lugar.
2. **`compress: false` no `next.config.ts` fica.** Sem ela o SSE morre em
   silêncio: replay em rajada e nenhum heartbeat. Parece bug de protocolo, é gzip.
3. **Campo de entrada nunca abaixo de 16px** (`--ck-text-md`). Abaixo disso o
   Safari dá zoom ao focar e o layout salta.
4. **Teto de 300 linhas por arquivo.** Passou, está fazendo duas coisas.
5. **Nunca `next dev` genérico nem `pkill next`** — derruba o cockpit do Rica na
   3007. Use a skill `subir-cockpit`.

## Skills daqui

`subir-cockpit` · `novo-renderer` · `mexer-na-pele` · `checar-paridade`

## Onde as coisas estão

- `app/globals.css` — tokens. §A pele (Daniel), §B esqueleto (Pavan)
- `components/shell/` — AppShell, três colunas, gaveta
- `components/chat/` — composer, lista, bolha
- `components/render/` — um arquivo por família de payload
- `@grupo_borges/cockpit-core` — lógica pura, sem React. Consumido como source
- `../../fixtures/cockpit-v2/familias/` — 52 famílias reais. Renderer se escreve
  contra elas, nunca contra payload imaginado
