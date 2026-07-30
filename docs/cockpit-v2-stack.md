# STACK.md — contrato de stack do Cockpit v2

> Passo 2 da ordem em `cockpit-v2-fusao.md`. Este arquivo existe para que **nenhum
> construtor precise adivinhar** versão, porta, pasta ou configuração. Quem for
> escrever código em `apps/cockpit` lê isto **antes**.
>
> Companheiros: `cockpit-v2-playbook.md` (pesquisa), `cockpit-v2-estetica.md`
> (a pele, do Daniel), `cockpit-v2-ownership.md` (quem mexe onde),
> `cockpit-v2-data-contract.md` (payload → tela), `fixtures/cockpit-v2/README.md`
> (baseline de paridade).

---

## 1. Versões — pinadas exatas, sem acento circunflexo

Medido no `apps/web` que está no ar em 2026-07-30, não copiado do `package.json`
(lá está tudo com `^`, que resolve diferente amanhã):

| peça | versão exata | observação |
|---|---|---|
| Node | `22.22.1` | o que está na máquina |
| pnpm | `10.20.0` | via `corepack pnpm`, **não existe `pnpm` no PATH** |
| next | `16.2.6` | |
| react / react-dom | `19.2.6` | |
| tailwindcss | `4.3.0` | |
| typescript | `~5.7` | |

**Por que exato e não `^`:** quem constrói aqui são LLMs. Uma versão que resolve
sozinha para a próxima minor troca a API por baixo do construtor, e o modelo
alucina em cima da diferença sem saber que ela existe. Pin não corrige alucinação,
mas remove uma fonte inteira dela.

⚠️ **`corepack pnpm` avisa que existe pnpm `11.18.0`. Não atualizar.** O
`apps/web` que está no ar foi instalado com a 10.20.0; subir major do gerenciador
de pacotes durante a migração troca duas variáveis ao mesmo tempo.

---

## 2. Onde o app vive, e em que porta

- Caminho: **`apps/cockpit`**. Nunca `web2` — nome provisório vira fóssil.
- Porta de dev: **3008**.

Portas já ocupadas nesta máquina (`srv1061129`), motivo de 3008 e não outra:

| porta | quem | observação |
|---|---|---|
| 3000 | easypanel (docker) | `0.0.0.0`, não é nosso |
| 3007 | `apps/web`, o cockpit **atual** | `next dev` de pé há 3 dias, ~248 MB |
| 8000 | `apps/api` (uvicorn FastAPI) | `127.0.0.1` |
| 3443 | `tailscale serve` → 3007 | é por aqui que o Rica abre |
| 6080 | `tailscale serve` → 6080 | |

**O cockpit atual roda em `next dev`, não em build de produção.** Isso importa por
dois motivos: ele é mais frágil do que parece, e o gate numérico do v2 tem de
medir contra **este** backend, não contra um `next build` idealizado.

Acesso: `https://srv1061129.tailfe77db.ts.net:3443` (Tailscale Serve, certificado
Let's Encrypt real). **Nunca pelo IP `100.x`** — origem sem HTTPS não expõe
microfone, e o modo voz simplesmente não existe lá.

---

## 3. O workspace pnpm — a decisão, e a evidência que a sustenta

**Estado encontrado:** o `grupo_borges` **não é um workspace pnpm**. Não há
`package.json` na raiz, não há `pnpm-workspace.yaml`, não há `turbo.json`.
`packages/shared-types/` contém um `.gitkeep` e nada mais — nunca foi usado.
`apps/web` é um projeto pnpm isolado, com lockfile e `node_modules` (556 MB)
próprios.

**Decisão:** criar o workspace na raiz com glob **explícito**, deixando
`apps/web` **fora** dele:

```yaml
# pnpm-workspace.yaml (raiz)
packages:
  - 'apps/cockpit'
  - 'packages/*'
```

`apps/web` fora do glob é o que protege o cockpit no ar: ele nunca é reinstalado,
nunca tem `node_modules` mexido, nunca depende do lockfile novo.

### O que foi medido (pnpm 10.20.0, topologia falsa em `/tmp`, não no repo real)

| cenário | resultado |
|---|---|
| `pnpm install` na **raiz** | escopo = raiz + pacotes do glob. `apps/web` **intocado** |
| `pnpm install` **dentro** de um app fora do glob | pnpm sobe até a raiz, opera no workspace todo e **ignora o app em silêncio**; cria `node_modules` na raiz |
| idem, com `--ignore-workspace` | isola certo: `node_modules` e lockfile ficam no app, raiz intocada |
| idem, com `.npmrc` contendo `ignore-workspace=true` | **não funciona.** O pnpm ignora a config e volta ao escopo do workspace |

Duas consequências que só aparecem porque foi medido:

1. **Não existe arquivo que proteja o `apps/web`.** A intuição de plantar um
   `.npmrc` lá dentro está errada — a config é ignorada, só a flag de linha de
   comando vale. Então não se escreve nada dentro de `apps/web`: seria um arquivo
   inerte no único app que decidimos não tocar.
2. **O erro possível não é destrutivo.** Rodar `pnpm install` por engano dentro do
   `apps/web` não apaga nem degrada o app — apenas não faz nada por ele e deixa um
   `node_modules` órfão na raiz. Custo de um engano: confusão, não incidente.

Se algum dia for realmente necessário instalar no cockpit velho:

```bash
cd apps/web && corepack pnpm install --ignore-workspace
```

### "Extrair" `cockpit-core` significa copiar, não mover

O `apps/web` está **congelado por decisão do Rica** (o próprio bug do clear ficou
para o v2). Logo `packages/cockpit-core` nasce como a **cópia canônica nova**, e o
`apps/web/lib/` segue com a dele até o app morrer. A divergência entre as duas é
**intencional**: um lado evolui, o outro está em manutenção zero. Ninguém deve
tentar fazer o `apps/web` importar do pacote — isso reintroduz exatamente o risco
de React duplicado e alias cruzado que a fusão rejeitou.

---

## 4. Herança obrigatória do `next.config.ts`

Três configurações do cockpit atual **têm de ser copiadas**, e uma delas é a
armadilha mais cara deste projeto:

```ts
compress: false,
```

**Por que:** SSE quebra em `rewrites()` quando o servidor Node de dev aplica gzip
— os chunks pequenos ficam presos no decoder do browser. O sintoma não é erro: o
cliente vê o replay inicial em rajada e **nunca recebe heartbeat nem live**. Quem
esquecer esta linha vai depurar EventSource por horas procurando bug de protocolo
onde há bug de compressão.

```ts
allowedDevOrigins: ['127.0.0.1', 'localhost', '*.tailfe77db.ts.net', '100.107.56.38'],
```

Sem o domínio `.ts.net` na lista, o Next 16 recusa a origem em dev e o painel não
abre pelo Tailscale — que é o único jeito de o Rica abrir.

```ts
async rewrites() {
  return [
    { source: '/api/:path*', destination: `${API_BASE}/api/:path*` },
    { source: '/uploads/agents/:path*', destination: `${API_BASE}/uploads/agents/:path*` },
  ];
}
// API_BASE = process.env.API_BACKEND_URL ?? 'http://127.0.0.1:8000'
```

O front **não** fala com o FastAPI por URL absoluta: ele chama `/api/...` no
próprio host e o Next faz o proxy. É isso que faz o SSE atravessar o Tailscale sem
CORS e sem porta extra exposta.

---

## 5. Tailwind 4 sem PostCSS

O `apps/web` roda Tailwind `4.3.0` **sem `postcss.config.*`, sem
`tailwind.config.*` e sem `@tailwindcss/postcss` instalado**. O CSS declara só:

```css
@import "tailwindcss";
```

O Next 16 processa isso nativamente. Replicar igual no app novo: **não** criar
`postcss.config.js` "por costume" — configuração a mais aqui vira conflito de
pipeline, não segurança.

O que **não** herdamos: `@import "augmented-ui/..."`, e a paleta inteira de
`:root[data-theme="dark"]` (ciano `#00f0ff` sobre `#060b18`). É exatamente o
visual que o v2 joga fora.

---

## 6. Arquitetura de pastas — ordem direta do Rica

> *"A arquitetura das pastas do front-end tem que ser extremamente organizada para
> que o CC possa fazer a manutenção com facilidade depois."* — Rica, 2026-07-30

Isto não é preferência estética, é **orçamento de contexto**. Cada minuto que um
agente gasta procurando onde mora uma coisa é contexto queimado antes de a
primeira linha útil ser escrita. As regras:

1. **O nome diz o que é, não o que parece.** `chat/`, `tool-group/`, `diff/`.
   Proibido: `utils/`, `helpers/`, `misc/`, `common/`, `shared/` — pasta sem
   critério de entrada aceita qualquer coisa e viverá cheia de tudo.
2. **Um conceito por arquivo.** O `apps/web` tem um `cockpit-css.ts` de 40 KB e um
   `cockpit-types.ts` com 52 exports — arquivos assim obrigam a ler tudo para
   mudar uma linha, e é isso que estamos deixando para trás.
3. **Rasa por default.** Três níveis dentro de `app/` ou `components/` é o teto.
   Aninhamento existe para separar domínio, não para organizar por tipo.
4. **Colocalização:** o teste e a fixture moram ao lado do que testam, não numa
   `tests/` paralela que espelha a árvore e sai de sincronia.
5. **Nada de re-export barrel (`index.ts` que só reexporta).** Ele esconde a
   origem real do símbolo, e o agente que faz `git grep` acha o barrel em vez do
   código.
6. **Teto de linhas por arquivo: 300.** Passou disso, o arquivo está fazendo duas
   coisas. Vale para componente, hook e módulo.

Estrutura-alvo (materializada no passo 4, o scaffold):

```
apps/cockpit/
  CLAUDE.md              ← lido a cada turno por quem trabalha aqui; curto
  .claude/skills/        ← skills de manutenção (ver §7)
  app/
    globals.css          ← ÚNICO lugar com cor declarada. Congelado.
    layout.tsx
    page.tsx             ← lista da tropa
    agente/[slug]/       ← chat. Seleção de agente na URL, não em context
  components/
    shell/               ← AppShell, as três colunas, a gaveta
    chat/                ← composer, lista, bolha
    render/              ← um arquivo por família de payload (a cauda longa)
  lib/
    (só o que é exclusivo deste app; o resto vem de cockpit-core)
packages/cockpit-core/   ← lógica que sobrevive, sem React
```

---

## 7. `CLAUDE.md` e skills dentro do app

Também ordem do Rica: o app nasce com as ferramentas de manutenção dentro dele.

O `apps/cockpit/CLAUDE.md` é **curto** e funciona como índice ("mexeu em X → leia
Y"), não como manual. Persona auto-carregada é a camada que mais apodrece: tudo
que for detalhe vai para skill lida sob demanda.

Skills previstas — critério de existência é **tarefa repetida + regra fácil de
errar**, não "seria legal ter":

| skill | por que ela existe |
|---|---|
| `subir-cockpit` | subir/derrubar o dev **da porta 3008** sem tocar no 3007. `next dev` genérico ou `pkill next` já derrubou o cockpit da frota antes |
| `novo-renderer` | são 23 tools e 25 formas de `tool_use_result`; adicionar renderer é o trabalho mais repetido do projeto, e errar o agrupamento não dá erro, dá tela torta |
| `mexer-na-pele` | cor só existe em `globals.css`. A skill inclui a varredura de hex solto, que é o modo de falha real |
| `checar-paridade` | roda o checklist de equivalência contra as fixtures gravadas antes de qualquer merge |

---

## 8. Correção de vocabulário: `convertMessage` não é nosso

A fusão manda documentar "a assinatura do `convertMessage`". **Essa função não
existe no nosso código** — `git grep` só a encontra dentro dos nossos próprios
documentos. É vocabulário do `assistant-ui`: o nome do slot que a biblioteca pede
quando se usa `useExternalStoreRuntime`.

Consequência prática: se o spike do `assistant-ui` (passo 5) falhar e cairmos para
shadcn-only, `convertMessage` **nunca vai existir**. O ativo real, que sobrevive
nos dois caminhos, é `buildRenderItems(messages: MessagePayload[]): RenderItem[]`
em `lib/render-items.ts`. O contrato de dados é escrito em cima dele — ver
`cockpit-v2-data-contract.md`.

---

## 9. Verificações já feitas — não repetir

- **HTTP/2 no `tailscale serve`: confirmado.** `curl` negocia `http_version=2`
  contra `https://srv1061129.tailfe77db.ts.net:3443`. O risco de os dois
  `EventSource` mais os fetches baterem no teto de ~6 conexões por host do Safari
  **está eliminado** — com multiplexing não há fila. Era o maior risco técnico
  aberto da lista.
- **`compress: false` é obrigatório** (§4). Medido pelo cockpit atual, não
  deduzido.
- **Comportamento do pnpm fora do glob** (§3), incluindo o `.npmrc` que não
  funciona.
