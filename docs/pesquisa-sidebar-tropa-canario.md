# Pesquisa — a coluna TROPA e o que o shadcn/mercado oferecem (09/08/2026)

> Pedido do Vinicius (Movelmar): antes de ele propor a melhoria de UI da coluna
> TROPA (sidebar de agentes) do Cockpit V2, esta pesquisa cobre três frentes —
> (1) o que o registro shadcn tem pronto e aplicável, (2) a doc oficial da
> Sidebar + Tailwind v4, (3) o padrão de mercado para lista densa de sessões ao
> vivo. O Vinicius já leu o código; aqui a régua é **fonte citada** (id da lib no
> Context7, nome do block no registro, link oficial) ou "não encontrei". Nada
> implementado; `apps/cockpit` intocado.
>
> Restrições do pedido e do contrato que amarram qualquer proposta futura:
> dark only · a fonte de dados é `/api/fleet` (não inventar campo) · cor nunca
> sozinha (§3 do `cockpit-v2-estetica.md`) · tokens `--ck-*` existentes ·
> `Tropa` é Server Component (proposta com estado de cliente precisa dizer o
> custo).
>
> **O 'antes' deste doc está em `docs/referencias-ui/sidebar-tropa-reprovada-09-08.png`**
> — a coluna que o Rica reprovou em 09/08 (a dança da posição por estado,
> consertada em 11/08: ordem estável por nome).

## 0. Ferramenta indisponível — declarada

O pedido citava o **MCP `shadcn`** ("varra o registro"). **Não está configurado
nesta sessão**: a única MCP HTTP montada é `higgsfield` (não é o registro shadcn);
disponíveis também o Context7 e o Telegram. Não vou fingir que varri com ele. A
frente 1 foi coberta com **Context7 na lib `/shadcn-ui/ui`** + a doc oficial
(`ui.shadcn.com` / o registro em `github.com/shadcn-ui/ui`), que são a mesma
fonte que o MCP shadcn consome. Onde só o MCP alcançaria, está marcado.

---

## 1. Frente 1 — o que o registro shadcn tem pronto (via Context7 `/shadcn-ui/ui`)

### 1.1 Os blocks `sidebar-01`..`sidebar-16` — e qual deles é o nosso

Registro oficial de primeira parte lido em
`apps/v4/registry/new-york-v4/blocks/_registry.ts` (Context7 `/shadcn-ui/ui`,
fonte: github.com/shadcn-ui/ui). Descrições literais do registro:

| Block | Descrição (do registro) | Relevância para a TROPA |
|---|---|---|
| `sidebar-01` | "A simple sidebar with navigation grouped by section" | anatomia mínima — GroupLabel + Menu |
| `sidebar-02` | "A sidebar with collapsible sections" | agrupamento com collapse por grupo |
| `sidebar-03` | "A sidebar with submenus" | submenu aninhado (não é a TROPA) |
| `sidebar-04` | "A floating sidebar with submenus" | `variant="floating"` |
| `sidebar-05` | "A sidebar with collapsible submenus" | idem |
| `sidebar-06` | "A sidebar with submenus as dropdowns" | submenu como dropdown |
| `sidebar-07` | "A sidebar that collapses to icons" | `collapsible="icon"` + `nav-user` (avatar) + `SidebarMenuBadge` |
| `sidebar-08` | "An inset sidebar with secondary navigation" | **já é a referência do cockpit** — o `app-shell.tsx` emprestou o `variant="inset"` ("igual o fluyt"). Tem `nav-user` |
| `sidebar-09` | "Collapsible nested sidebars" | dois níveis colapsáveis |
| `sidebar-10` | "A sidebar in a popover" | sidebar dentro de popover (não é) |
| `sidebar-11` | "A sidebar with a collapsible file tree" | file tree (não é) |
| `sidebar-12` | "A sidebar with a calendar" | não é |
| `sidebar-13` | "A sidebar in a dialog" | não é |
| `sidebar-14` | "A sidebar on the right" | posicionamento à direita |
| `sidebar-15` | "A left and right sidebar" | duas sidebars |
| `sidebar-16` | "A sidebar with a sticky site header" | header sticky + `nav-main`/`nav-user` |

**Resposta direta à pergunta do Vinicius — qual tem "lista de itens com avatar +
métrica":** nenhum block de sidebar tem **métrica de progresso por item** (isso
vive no `dashboard-01`, que é outra coisa). O que existe é a **combinação de
primitivos**: `SidebarMenuButton` com avatar no leading + `SidebarMenuBadge` com o
valor à direita. É exatamente isso que `sidebar-07`/`sidebar-08`/`sidebar-16`
fazem no `nav-user` (avatar) e no `nav-main` (`SidebarMenuBadge` = contador/pílula
à direita, `isActive` no item). Ou seja: **para a TROPA não há block pronto** —
há o esqueleto certo (item = `SidebarMenuButton` com `isActive` + badge à direita)
e a métrica de contexto é composição nossa por cima (a `Barra` + `%` que a
`statusline.tsx` já faz).

A anatomia que os 16 blocks ensinam e que vale para nós:

```
SidebarProvider                      ← estado de cliente (custado, ver §1.3)
├── Sidebar  (variant sidebar|floating|inset · collapsible offcanvas|icon|none)
│   ├── SidebarHeader                ← sticky no topo (branding, switcher)
│   ├── SidebarContent               ← região rolável ENTRE header e footer
│   │   └── SidebarGroup
│   │       ├── SidebarGroupLabel    ← overline de seção (o nosso "Tropa"/"Offline")
│   │       ├── SidebarGroupAction
│   │       └── SidebarGroupContent
│   │           └── SidebarMenu
│   │               └── SidebarMenuItem
│   │                   ├── SidebarMenuButton  ← o ITEM (asChild, isActive, size)
│   │                   ├── SidebarMenuAction
│   │                   └── SidebarMenuBadge   ← o valor à direita (contador)
│   └── SidebarFooter                ← sticky no fim (nav-user, status)
├── SidebarRail
├── SidebarInset                     ← envolve o conteúdo no variant="inset"
└── SidebarTrigger
```

Fonte: Context7 `/shadcn-ui/ui` (docs `base/sidebar.mdx` e `aria/sidebar.mdx`).

### 1.2 `SidebarMenuButton` — o item, com estados reais

É o único primitivo que toca o que a TROPA faz (item clicável com seleção). Da
doc oficial (trecho real, `base/sidebar.mdx`):

```tsx
<SidebarMenuButton asChild isActive>
  <a href="#">Home</a>
</SidebarMenuButton>
```

- **`asChild`** — `true` renderiza o filho (um `<Link>` do Next) no lugar do
  `<button>`; **é o que o cockpit precisa** (cada item da tropa já é um `<Link>`).
- **`isActive`** — marca o item ativo; emite **`data-active={isActive}`** no DOM,
  e o CSS oficial usa seletor de peer (`peer-data-[active=true]/menu-button`) para
  revelar ação ao lado. **É o portador acessível** do "selecionado" (o cockpit
  hoje usa `aria-current="page"` + filete de 2px — compatível, ver §1.3).
- **`size`** (`default` | `lg` | `sm`) e **`variant`** — densidade/aparência do
  item; o cockpit já governa altura por `--ck-touch-min` (44px), então o `size`
  shadcn é reescrito pelo token.
- **`tooltip`** — string ou `TooltipContent`; o próprio shadcn só o mostra quando
  a sidebar está colapsada e **não em mobile** (`hidden={state !== "collapsed" ||
  isMobile}`). Confirma: tooltip é desktop-colapso, não fonte de estado.
- Data attrs: `data-slot="sidebar-menu-button"`, `data-sidebar="menu-button"`,
  `data-size={size}`, `data-active={isActive}` (fonte: `ui/sidebar.tsx`, trecho
  real obtido via Context7).

### 1.3 O custo que o `SidebarProvider` cobra — e por que a TROPA hoje NÃO o usa

O `app-shell.tsx` (comentário de linha 24) já registrou a decisão: **"Cada gaveta
é um `<aside>` próprio, nunca um `SidebarProvider`"** — o provider é estado de
cliente e quebraria "a decisão nº 1: superfície mora na URL, shell sem JavaScript
no cliente" (deep-link do Telegram, botão voltar do Android). **Isto continua de
pé.** A proposta do Vinicius não pode assumir que o provider entra de graça: usar
`SidebarProvider` num item da tropa custa converter o `Tropa` em client component
ou montar um provider extra. O caminho de menor custo — e o que os 16 blocks
validam como anatomia — é usar **os mesmos papéis sem o provider**: `GroupLabel`
sobre `MenuButton` com `isActive`/`aria-current` + `MenuBadge` à direita, que é
o que `tropa.tsx` já estrutura com `<nav>` + `<Overline>` + `<Link>`.

`aria-current="page"` (usado pelo `CartaoVivo`/`LinhaDormindo`) é o mecanismo
WAI-ARIA para "item de navegação atual" — equivalente semântico do `isActive`
shadcn, e o correto para uma lista de navegação. Nenhuma troca obrigatória; o
ganho de adotar `SidebarMenuButton` seria só o `data-active` padronizado (para
estilização por CSS em vez de prop).

### 1.4 Os outros componentes citados — serve, e para quê

Estado real no cockpit: **`avatar`, `badge`, `drawer`, `scroll-area` já estão em
`components/ui/`**; **`sidebar` NÃO está instalado** (confirmado no disco);
`radix-ui ^1.6.7` é a única dep primitiva (shadcn v4 monta tudo do pacote único
`radix-ui`).

| Componente | O que é (fonte) | Serve para a TROPA? |
|---|---|---|
| **`scroll-area`** | Radix `ScrollArea` (viewport + `Scrollbar` com `data-state`); já instalado | **Sim, é o que a rolagem por dentro usa hoje** (o `<nav>` da tropa já faz `overflow-y-auto`). A TROPA **não precisa de scroll custom** para rolar; o Radix só compra a barra estilizada. Custo: um nível de wrapper. |
| **`tooltip`** | Radix `Tooltip` — **hover-only** (pointerenter/pointerleave) | **Não para estado.** No celular (superfície principal do Rica) não abre. O shadcn só o usa quando a sidebar está colapsada. Se precisar de "por que esse número", o caminho é `Popover` no tap (já tem `drawer`; a família `Popover` exige `@radix-ui/react-popover`/radix-ui, uma dep). |
| **`hover-card`** | Radix `HoverCard` — **hover-only**, igual tooltip | **Não.** Mesma limitação de touch. Não é fonte de estado. |
| **`progress`** | Radix `Progress` — `<Progress value={33} />`, expõe `aria-valuenow` | **Parcialmente.** O contrato a11y (ver §2 da pesquisa anterior / `_load_cc_status`) já decidiu: **% estático não é "progresso"** — é `meter` ou texto+barra decorativa (`aria-hidden`). A `Barra` da `statusline.tsx` já trata a barra como instrumento (traço no teto de 30%) e o número ao lado como leitura. Radix `Progress` não acrescenta: é role `progressbar`, o papel menos honesto para um valor medido. |
| **`collapsible`** | Radix `Collapsible` — `Trigger`/`Content` com `data-state="open|closed"` | **Talvez, e só para agrupamento.** Não para o item da tropa (que não colapsa conteúdo). Serviria se a proposta quiser grupos colapsáveis ("Tropa"/"Offline" dobráveis) — o contrato §7 prega densidade, então colapsar grupos mortos é tese defensável. Custo: estado local por grupo → client component. |
| **`separator`** | Radix `Separator` — `decorative`, `orientation`, `data-orientation` | **Sim, mas o cockpit já separa por `Overline` + `hairline`** sem dep. Não há motivo para trocar. |
| **`badge`** | `Badge` com `cva` variants | **Já usado** (`ChipEstado` em `tropa.tsx`, `variant="ghost"`). É o portador de palavra do estado (contrato: ponto + palavra). |

### 1.5 Veredito da frente 1

- **Block pronto para a TROPA: não existe.** O registro tem sidebar de navegação
  de app, não "lista de 9 agentes com modelo + % de contexto". O que existe é o
  **padrão anatômico**: `SidebarGroupLabel` + `SidebarMenuButton` (`asChild`,
  `isActive`) + `SidebarMenuBadge` à direita — e o cockpit **já segue esse padrão**
  por conta própria (Overline + Link + chip/barra). A proposta do Vinicius deve
  partir do que já está, não de uma migração.
- **`sidebar` não está instalado e o `SidebarProvider` custa estado de cliente**
  — ambos pesam contra adotar o componente pronto.
- **`scroll-area`** é a única adição com custo zero e ganho visual claro (barra de
  rolagem estilizada), se o Rica pedir; hoje o `overflow-y-auto` resolve.
- **`tooltip`/`hover-card`: fora** (touch). **`progress`: papel errado** para
  valor estático. **`collapsible`/`separator`**: opcionais e custam cliente.

---

## 2. Frente 2 — doc oficial da Sidebar + o que Tailwind v4 dá

### 2.1 Sidebar — variantes, colapso, estados (doc oficial, trechos reais)

Da `base/sidebar.mdx` (Context7 `/shadcn-ui/ui`):

- **`variant`**: `sidebar` | `floating` | `inset`. **`inset` "requires wrapping
  content in `SidebarInset`"** — é o que o cockpit já imita no desktop
  (`SidebarInset` equivale ao `.ck-palco` sobre a `.ck-faixa`; o `app-shell.tsx`
  registrou que emprestou o CSS do `sidebar-08`, recusou o provider).
- **`collapsible`**: `offcanvas` ("slides in from the left or right"), `icon`
  ("collapses to icons"), `none` ("non-collapsible"). O cockpit hoje usa "mesa e
  folha" no desktop (coluna fixa de 260px, sem colapso) e gaveta no celular — que
  é semanticamente um `offcanvas` **feito à mão** (`GavetaNav`).
- **Estados de `SidebarMenuButton`** (trecho real):

```tsx
function SidebarMenuButton({
  asChild = false,
  isActive = false,
  variant = "default",
  size = "default",
  tooltip,
  ...
}) {
  const button = (
    <Comp
      data-slot="sidebar-menu-button"
      data-size={size}
      data-active={isActive}
      className={cn(sidebarMenuButtonVariants({ variant, size }), className)}
      {...props}
    />
  )
  // tooltip só quando state==="collapsed" && !isMobile
}
```

  → **`isActive`** é o único portador de "ativo" do componente; o destaque visual
  (hover vs ativo) fica no CSS do consumidor, por cima de `data-active` e dos
  tokens `--sidebar-*`. O cockpit já tem o equivalente com `aria-current` + filete
  e o contrato §2.6 (véu de 3 degraus + filete de 2px) define a diferença hover/
  ativo/pressed — não precisa do token shadcn.
- **`useSidebar()`** expõe `state: "expanded" | "collapsed"`, `open`, `isMobile`,
  `toggleSidebar`; atalho `cmd+b`/`ctrl+b`. Só existe dentro do provider.

### 2.2 Tailwind v4 — o que é útil para a TROPA (fonte: `/websites/tailwindcss`)

O que a doc da v4 oferece e que toca lista densa:

- **`truncate` / `text-ellipsis` / `text-clip`** — "prevents text wrapping and
  adds an ellipsis". A TROPA já usa `truncate` (nome, modelo, pasta). Regra da
  casa: o **valor de contexto não trunca** (é o dado que decide `/compact`).
- **`scrollbar-width`** — utilitários `scrollbar-thin`, `scrollbar-none` e
  variantes de breakpoint (`md:scrollbar-auto`). **Em Tailwind v4 isso é nativo**,
  sem CSS custom; o cockpit hoje pinta o scrollbar por CSS próprio (§18.4). Se a
  proposta quiser a barra do app na tropa, o utilitário existe.
- **Container queries** — `@container`/`@sm`/`@lg` para estilizar pelo **container**
  pai, não o viewport. A TROPA tem exatamente o caso: mesmo componente em coluna
  de 260px (`compacta=true`) e tela cheia (`compacta=false`). O cockpit resolve isso
  com a prop `compacta`; container queries seriam a alternativa (custo: nada, a v4
  tem nativo) — mas **trocar agora não é necessário**, a prop já cobre os dois
  layouts e é testada (`tropa.tsx`).
- **`flex-col`, `flex-1`, `min-w-0`** — os tijolos do layout; já em uso.
- **`space-y-*`** — gap entre linhas empilhadas (a Linear usa `space-y-0.5`; ver §3).
- **`tabular-nums`** — via `font-variant-numeric`; o `--ck-font-mono` já carrega, e
  o `%` da tropa é o caso documentado no `estetica.md` §4 (número que "dança" a
  cada atualização — precisa da classe utilitária).
- **Arbitrário com variáveis CSS** — `grayscale-(--var)` / `bg-[...]`: permite
  consumir `--ck-*` direto em classe; o cockpit prefere `style` inline com
  `var(--ck-*)` — escolha local, ambas valem.
- **`focus-visible` + `ring`** — foco de teclado não só cor (§3 do contrato exige
  outline). Os itens da tropa são `<Link>`; o foco default do browser pode ser
  trocado por `focus-visible:ring`.

---

## 3. Frente 3 — padrão de mercado para lista densa de sessões ao vivo

A TROPA é: 9 agentes, cada um com estado + modelo + % de contexto. As referências
que valem são os apps de nav lateral densa com status. O que as fontes mostram:

### 3.1 Linear — a referência direta de densidade (medidas literais)

Fonte: "I Cloned Linear's Sidebar" (dev.to) + o artigo oficial de redesign. Do
clone (classes literais):

- **Largura fixa `w-64` (256px)** — o mesmo espírito dos 260px da nossa coluna.
- **Row de nav: `px-2 py-1.5` (~6px verticais) + `text-sm` (14px) + `space-y-0.5`
  (~2px entre linhas)** — densidade por **reduzir o padding e o gap**, não a fonte.
- **Seções: `text-xs uppercase tracking-widest pt-4 pb-1`** — o overline de seção
  cria respiração vertical **dentro** da densidade (é o nosso `Overline`).
- **Escada de 4 tons de superfície** (dark): página `#16161a` → sidebar `#1c1c20`
  → hover/borda `#26262b` → **ativo `#2a2a30`**. Item ativo destaca **por
  luminosidade** (fundo mais claro) + `text-white` — **não por cor de acento**.
  Hover = mesmo tom das bordas. Isto é exatamente a tese do `estetica.md` §1
  ("luz em vez de sombra; hierarquia por luminância") e o véu do §2.6.
- **Badge/contador à direita com `ml-auto`, em pílula** (`px-1.5 rounded-full`) —
  o `SidebarMenuBadge` shadcn; o cockpit põe chip/barra no fim da linha com `shrink-0`.
- **Dot de status `w-2 h-2` (8px)** com cores semânticas (verde ativo, âmbar WIP,
  cinza idle) — **mas sempre com palavra** ao lado em produto de verdade (o
  `estetica.md` §3 proíbe cor sozinha).
- Footer fixo com status "● Online" — espelha a ideia de um rodapé de estado.

Do artigo oficial (Linear "How we redesigned the Linear UI"): **Inter Display só
em títulos, Inter regular no corpo** (duas vozes tipográficas, como a nossa
§4 "sans é a voz do produto, mono é a voz da máquina"); **alinhar labels, ícones
e botões vertical e horizontalmente na sidebar** — trabalho invisível que o
usuário sente "após alguns minutos", não na primeira olhada; troca do espaço de cor
para **LCH** (perceptualmente uniforme) e **temas de alto contraste gerados
automaticamente** para acessibilidade; aumento do contraste do conteúdo no final.

### 3.2 O que separa uma lista boa de uma ruim — o que o mercado mostra

Síntese das fontes (UI Syntax dashboard playbook; pesquisa sparkline vs barra vs
número):

1. **Hierarquia tipográfica.** Uma fonte/voz para o item (nome), outra voz (menor,
   mono) para a métrica; overline de seção em caixa alta espaçada para respirar. A
   TROPA já faz (nome em sans `--ck-text-sm/base`, statusline em mono `--ck-text-xs`,
   overline uppercase).
2. **Densidade é decisão de produto, não gosto.** "Power users need higher
   density; casual users need more spacing. Provide a compact toggle (-20–30%
   padding)." A TROPA tem os dois modos **pela superfície** (coluna vs tela cheia) —
   não há "alternar densidade" no mesmo lugar, e isso é coerente.
3. **Métrica inline: número como leitura primária, barra para estado, sparkline
   para tendência.** A regra do mercado: **número = precisão (leitura primária),
   barra = progresso/estado, sparkline = tendência** (24–32px, eixo y fixo ao
   comparar). A TROPA já escolheu **número + barra com teto** — o correto para
   "quanto falta para 30%?". Para **contexto** (janela, valor estático) sparkline
   é o instrumento errado — **mas não porque o dado não exista**: o `sparkline`
   de 24 buckets está no `/api/fleet` (DS-58) e é série temporal de verdade, que
   serve para **atividade de 24h** (dado que a TROPA hoje descarta). Recomendação
   do mercado: "quebrar a estrutura em um único card força o usuário a reaprender
   a ler" — consistência entre linhas é o que dá a sensação de rápido.
4. **Hover vs selecionado: dois degraus claramente distintos.** Linear: hover =
   tom da borda (1 degrau), ativo = tom mais claro + texto branco (2 degraus). O
   contrato §2.6 já fixa exatamente isso (3 véus + filete no ativo). A proposta do
   Vinicius não deve **inventar** hover/ativo — deve consumir `--ck-overlay-*` e o
   filete.
5. **Scroll.** Lista que rola por dentro com a barra não roubando largura
   (`overflow-y-auto` + `scrollbar-width` custom da v4). O `app-shell` já governa
   `h-dvh` + `overflow-hidden`; a tropa rola por dentro.
6. **Estado sempre ponto + palavra.** Slack/Linear usam dot colorido, mas produto
   de qualidade acompanha palavra ou contraste semântico; a pesquisa anterior do
   Canário (para o Daniel) já concluiu: **texto visível carrega o estado, cor é
   reforço**. O `ChipEstado`/`marca` do retrato já cumpre.

### 3.3 O que NÃO copiar de mercado (o contrato local manda)

- **`--ck-text-tertiary` nunca em texto < 20px** — a Linear usa `text-slate-500`
  (muted) para muito texto pequeno; no nosso caso a régua é a §2.2 (tertiary só
  ícone/separador/texto ≥20px). Metadado da tropa em `secondary`.
- **Véu proibido sobre `--ck-surface-raised`** (§2.6) — qualquer hover/ativo novo
  vive no `nav`, não em superfície elevada.
- **44px de alvo de toque** (§3) — a Linear tem linhas de ~28px (desktop
  mouse-only); a TROPA é usada no celular do Rica, e o `--ck-touch-min` prevalece.
  Densidade vem de gap/padding, não de encolher o alvo.
- **Cor nunca sozinha** — dot + palavra (já implementado).

---

## 4. O que a proposta do Vinicius deve (e não deve) assumir — resumo executivo

1. **Nenhum block shadcn é a TROPA.** O registro oferece a anatomia certa
   (`SidebarGroupLabel` + `SidebarMenuButton`/`isActive`/`asChild` + `SidebarMenuBadge`),
   e a TROPA **já segue essa anatomia** por conta própria. Proposta deve **polir o
   que existe**, não migrar para `sidebar.tsx`.
2. **`SidebarProvider` custa o Server Component** (decisão nº 1 do `app-shell.tsx`).
   Se a proposta quiser algo do provider (colapso, atalho cmd+b), o custo é
   explícito: converter a superfície para client ou aceitar provider no shell.
3. **A métrica certa para "contexto" é número + barra com teto** (não sparkline,
   não Radix Progress). Já está implementado e é o padrão do mercado para
   "quanto falta para o alvo".
4. **hover/ativo já estão resolvidos no contrato** (`--ck-overlay-*` + filete).
   Proposta não inventa degrau novo; se tocar, usa os tokens.
5. **Tailwind v4 já oferece `scrollbar-thin` e container queries nativos** — se a
   proposta mexer em rolagem ou no par coluna/tela-cheia, existem utilitários sem
   CSS custom.
6. **Tudo novo deve vir de `/api/fleet` — e o dado existe.** Placa (09/08,
   correção do Vinicius, conferida no schema): **a API TEM histórico**. Cada
   agente vem com `sparkline: SparklineBucket[]` de 24 buckets
   (`{bucket, count, tokens}`, gap-fill com zero) — DS-58, no contrato
   `packages/cockpit-core/src/cockpit-types.ts:76` e renderizado pelo cockpit
   antigo em `apps/web/components/sparkline.tsx` (variante compacta
   `SparklinePulse`, normalizada pelo max do próprio agente). O que a minha
   afirmação anterior dizia ("a API não tem histórico") estava **errado** — eu
   declarei a ausência de um dado sem abrir o endpoint. A régua, aprendida com o
   Vinicius: quando a restrição for "não inventar dado", **abrir o endpoint antes
   de declarar o que ele não tem**. O achado nº 3 continua de pé (para
   **contexto** — janela, valor estático — a régua é número + barra com teto, e
   sparkline seria o instrumento errado ali); o que o Vinicius propõe é outro
   dado: **atividade de 24h**, série temporal de verdade que a TROPA hoje
   descarta inteiro.

## 5. Não consegui confirmar

- **Conteúdo visual dos blocks `sidebar-03/05/06/09/11/12`** além da descrição de
  uma linha do registro (não abri cada page.tsx). Descrições acima vêm do
  `_registry.ts` oficial; para decisão fina sobre esses, abrir o arquivo.
- **Densidade real em px da Linear pós-redesign** (o artigo oficial não dá números;
  os números da §3.1 vêm do clone dev.to, não da Linear).
- **Slack/Raycast específicos**: a busca por "Slack unread badge / Raycast row
  height" não retornou fonte citável; onde citei Slack/Raycast acima é por padrão
  geral (dot + palavra), ancorado nas outras fontes, não em doc deles.
- **`Popover` do shadcn no cockpit** — não conferi se `components/ui/popover.tsx`
  existe (só `drawer`, `scroll-area`, `avatar`, `badge` foram confirmados no
  disco).

> **Placa — o que eu afirmei errado e o Vinicius corrigiu (09/08):** a versão
> anterior desta §5 declarava que "a API não tem histórico" como base do item 6 do
> resumo executivo. Errado. O `/api/fleet` traz `sparkline: SparklineBucket[]`
> (24 buckets, DS-58, gap-fill com zero) por agente — contrato em
> `packages/cockpit-core/src/cockpit-types.ts:76`, renderizado pelo v1 em
> `apps/web/components/sparkline.tsx` (`SparklinePulse`, normalizada pelo max
> próprio). A lição, registrada para despachos futuros: **antes de declarar o que
> um endpoint não tem, abrir o endpoint** — leva segundos e muda a conclusão. O
> achado nº 3 (contexto = número + barra com teto) segue válido; a novidade é que
> a TROPA descarta o histórico de atividade de 24h, dado que existe.

## 6. Fontes

- Registro oficial de blocks (sidebar-01..16, descrições literais):
  https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/new-york-v4/blocks/_registry.ts
  (Context7 `/shadcn-ui/ui`)
- Doc da Sidebar (anatomia, variantes, collapsible, isActive):
  https://ui.shadcn.com/docs/components/sidebar (Context7 `/shadcn-ui/ui`,
  `apps/v4/content/docs/components/base/sidebar.mdx` e `aria/sidebar.mdx`)
- Código do `SidebarMenuButton` (data-active, tooltip, isMobile):
  https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/new-york-v4/ui/sidebar.tsx
- Tailwind v4 (truncate, scrollbar-width, container queries, flex):
  https://tailwindcss.com/docs/text-overflow · https://tailwindcss.com/docs/scrollbar-width ·
  https://tailwindcss.com/docs/responsive-design (Context7 `/websites/tailwindcss`)
- Linear — clone com medidas literais:
  https://dev.to/dev48v/i-cloned-linears-sidebar-in-50-lines-of-html-one-file-zero-npm-40ej
- Linear — artigo oficial de redesign (LCH, temas de alto contraste, alinhamento):
  https://linear.app/now/how-we-redesigned-the-linear-ui
- Sparkline vs barra vs número (precisão/estado/tendência, 24–32px, eixo fixo):
  https://www.lazarev.agency/articles/dashboard-ui-examples ·
  https://docs.rs/orbital-charts/latest/orbital_charts/fn.Sparkline.html ·
  https://www.shadcn.io/blocks/stats-progress-with-sparkline
- Dashboard UX (densidade como decisão de produto, cor só semântica, 4.5:1 dark):
  https://ui-syntax.com/playbooks/dashboard-ux-principles
- Touch targets 44×44, gap 8px, transições 150–300ms (WCAG 2.1 / plataformas):
  https://www.skill-gallery.jp/skills/5dlabs/web-design-guidelines (agrega as normas)

**Contrato consumido:** `docs/cockpit-v2-estetica.md` (§2.6 véu+filete, §3 piso de
contraste e cor-nunca-sozinha, §4 tipografia, §9 proibições) e `app-shell.tsx`
(decisão nº 1: superfície na URL, sem provider shadcn).
