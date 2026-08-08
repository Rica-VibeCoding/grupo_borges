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

`apps/web` fora do glob é o que protege o cockpit no ar: nenhum comando de rotina
na raiz o alcança — nem `pnpm install`, nem `pnpm -r`, nem `pnpm update`, nem
`pnpm dedupe`, nem CI. Confirmado por auditoria independente (Tara, 30/07), que
também verificou o escopo real: `pnpm list -r --depth -1` lista só a raiz,
`apps/cockpit` e `packages/cockpit-core`.

⚠️ **A proteção é contra engano de rotina, não contra intenção.** Existe um comando
que alcança o `apps/web`, e ele é justamente a via de escape documentada:

```bash
corepack pnpm --dir apps/web install --ignore-workspace   # = pnpm run instalar-cockpit-velho
```

Ou seja: só toca o cockpit velho quem **pede explicitamente** para tocá-lo. Não
existe caminho acidental — e essa é a garantia que importa.

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

## 5. Tailwind 4 EXIGE `@tailwindcss/postcss` — eu errei aqui

> ⚠️ **Esta seção dizia o oposto e estava errada.** Corrigida em 30/07 depois da
> auditoria de frontend (Kimi). Fica registrado o erro porque o raciocínio que levou
> a ele é repetível.

**O que eu escrevi:** que o `apps/web` roda Tailwind `4.3.0` sem
`postcss.config.*` e sem `@tailwindcss/postcss`, logo "o Next 16 processa
`@import "tailwindcss"` nativamente" e não se deve criar `postcss.config` "por
costume".

**O que é verdade:** o Next **não** processa. O `apps/web` não tem o plugin e por
isso **o Tailwind nunca rodou nele** — medido no CSS que ele serve agora mesmo:
278 KB, `@theme` **literal** (sinal de que o engine não passou), `box-sizing` de
preflight ausente e **zero** classe utilitária. Ele funciona porque o tema dele é
99% artesanal e não depende de utilitária nenhuma.

**O erro de método:** inferi capacidade a partir de ausência de configuração, sem
olhar a saída. O app "funcionava", então a premissa parecia confirmada — mas o que
eu tinha era um app cujas classes estavam todas mortas, e nenhum sintoma porque o
scaffold ainda era simples demais para depender delas.

**O certo, e é obrigatório:** `apps/cockpit/postcss.config.mjs` com

```js
const config = { plugins: { '@tailwindcss/postcss': {} } };
export default config;
```

mais `@tailwindcss/postcss` em `devDependencies` do app, na **mesma versão** do
`tailwindcss` (4.3.0). Não precisa na raiz do workspace — testei sem, do zero.

**Como saber se está funcionando** (nunca pela presença do import):

| | sem engine | com engine |
|---|---|---|
| bytes do CSS servido | 4.410 | 10.993 |
| `.flex` | 0 | 1 |
| `box-sizing` (preflight) | 0 | 2 |
| `@media (min-width: 48rem)` | 0 | 3 |
| `@theme inline` no CSS servido | 1 (literal) | 0 (consumido) |

⚠️ **O `.next` mascara mudança de `postcss.config` em silêncio.** Ao mexer nele:
derrubar o dev **pelo PID da porta**, mover o `.next`, subir de novo. Sem isso o
transform antigo continua valendo e você persegue a hipótese errada — foi o que
aconteceu comigo por três tentativas.

O que **não** herdamos do `apps/web`: `@import "augmented-ui/..."`, e a paleta
inteira de `:root[data-theme="dark"]` (ciano `#00f0ff` sobre `#060b18`). É
exatamente o visual que o v2 joga fora.

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
| `novo-renderer` | são 23 tools e 24 formas de `tool_use_result`; adicionar renderer é o trabalho mais repetido do projeto, e errar o agrupamento não dá erro, dá tela torta |
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

### E `useExternalStoreRuntime` mora em `legacy-runtime/` — o spike muda de porta

Achado ao instalar o pacote e ler os tipos, não a documentação (30/07,
`@assistant-ui/react` 0.15.1 + `@tanstack/react-virtual` 3.14.9, ambos pinados
exatos no `apps/cockpit`).

O caminho que a fusão presumia é reexportado de
`dist/legacy-runtime/runtime-cores/external-store/useExternalStoreRuntime.js`. Ao
lado dele existe `dist/client/ExternalThread.d.ts`, fora do `legacy-runtime`, cuja
assinatura é exatamente a nossa forma:

```ts
type ExternalThreadProps = {
  messages: readonly ExternalThreadMessage[];   // ThreadMessage & { id: string }
  isRunning?: boolean;
  isLoading?: boolean | undefined;
  onNew?: (message: AppendMessage) => void;
  // …
};
```

Uma thread alimentada por fonte externa, só-leitura, com callback para o envio —
que é literalmente o painel: ele **observa** sessões do Claude Code e manda texto de
volta por uma função nossa (`sendText(slug, texto)` do contrato de dados).

Minha primeira conclusão foi "o spike se constrói sobre `client/ExternalThread`", e
ela **está revogada** — durou vinte e cinco minutos, o tempo de ler uma linha a mais
do tipo:

```ts
declare const ExternalThread: import("@assistant-ui/tap").Resource<ClientOutput<"thread">, [ExternalThreadProps]>;
```

`ExternalThread` **não é componente React.** É um `Resource` do `@assistant-ui/tap`,
e o provider que o monta (`AuiProvider` / `useAui`) vem de `@assistant-ui/store` —
outro pacote. Os três Resources de `client/` (`ExternalThread`, `SingleThreadList`,
`InMemoryThreadList`) pertencem a esse runtime novo. Consumi-lo custa aprender dois
pacotes internos sem documentação, **dentro de um spike cujo objetivo é medir
frame**.

**Decisão: o spike mede `useExternalStoreRuntime`**, o caminho de hook React —
familiar, e o único que a verificação de código da fusão de fato examinou (WeakMap
por identidade do objeto, lista assinando só `length`, memo por item, bail-out por
`Object.is`).

Duas consequências que ficam registradas, e a segunda pesa na decisão do Rica:

- A evidência de "legacy" é **topologia de pacote**, não tag `@deprecated` — não há
  nenhuma nos dois arquivos. Serve para saber onde a lib está indo, não para acusar
  o caminho atual de morto.
- **Se o `assistant-ui` passar no gate e ficar, herdamos uma migração conhecida**
  para o runtime `client/`. Isso não é surpresa futura, é dívida declarada agora — e
  é exatamente o tipo de custo que o argumento de processo do kimi previa quando
  disse que a biblioteca tem um dia de idade.

---

## 9. Verificações já feitas — não repetir

- **"Eu só uso Chrome" NÃO tira o WebKit da conta.** O Rica avisou em 08/08 que
  não usa Safari, e no PC isso vale: lá o Chrome é Blink de verdade. **No iPhone
  dele, não vale.** A regra 2.5.6 da App Store obriga, verbatim: *"Apps that
  browse the web must use the appropriate WebKit framework and WebKit
  JavaScript"* — o entitlement de motor alternativo existe só para **UE e
  Japão**, e o Brasil não está na lista. Chrome no iPhone é casca em cima do
  WebKit. Consequência prática, e ela já custou uma caçada inteira (a gaveta de
  0px, estética §"02/08"): bug que só aparece no aparelho dele é bug de WebKit,
  e recurso novo se confere na coluna do Safari, nunca na do Chrome.
  Fonte: https://developer.apple.com/app-store/review/guidelines/ §2.5.6.
- **HTTP/2 no `tailscale serve`: confirmado.** `curl` negocia `http_version=2`
  contra `https://srv1061129.tailfe77db.ts.net:3443`. O risco de os dois
  `EventSource` mais os fetches baterem no teto de ~6 conexões por host do Safari
  **está eliminado** — com multiplexing não há fila. Era o maior risco técnico
  aberto da lista.
- **`compress: false` é obrigatório** (§4). Medido pelo cockpit atual, não
  deduzido.
- **Comportamento do pnpm fora do glob** (§3), incluindo o `.npmrc` que não
  funciona.

---

## 10. Desenvolvimento remoto — front no PC, backend na VPS

Acordado em 04/08/2026 entre o Pavan (VPS) e o Claude do PC, por ordem do Rica. Vale
pra quem for editar `apps/cockpit` de fora da VPS.

### A regra

**O backend é um só e vive na VPS. Nunca subir `apps/api` no PC.**

Não é preferência. O `apps/api` instancia `TmuxDriver` (`main.py:65`) e comanda as sessões
tmux dos agentes, lê os JSONL de `Path.home()/.claude/projects` (`config.py:40`) e escreve
num SQLite de ~1,5 GB. Nada disso existe fora da VPS, e replicar significaria clonar a frota
inteira. Sintoma correlato já visto: a suíte da API acusa falhas por caminho POSIX quando
roda no Windows.

**O front pode rodar onde o construtor estiver**, apontando pro backend da VPS.

### Como o front local acha o backend

```
# apps/cockpit/.env.development.local   (não versionado — é por máquina)
API_BACKEND_URL=https://srv1061129.tailfe77db.ts.net:3445
```

`.env.development.local` e **não** `.env.local`: o `.local` puro também vale em
`next build`, e aí um build local sairia apontando pro backend remoto sem ninguém
perceber. O `.env.development.example` versionado ao lado é a cópia pra quem chega.

Antes disso a variável era exportada inline a cada `pnpm dev`. Era a causa do
"local nunca funciona igual": com ela, funciona; sem ela, o front procura
`127.0.0.1:8000`, que não existe no PC, e a tela quebra sem dizer por quê.

### Por que a :3445 e não a :3444

A **:3445 é rota dedicada pra API** (`tailscale serve --bg --https 3445 http://127.0.0.1:8000`).

A :3444 aponta pro *front* da VPS (3008), que só então reescreve pra 8000 — dois saltos. Pior:
esse primeiro salto derruba conexão longa. Foi medido em 04/08, quando um relaunch pela :3444
devolveu `500 / socket hang up` enquanto o backend direto respondia 200. Relaunch e SSE são
conexões longas; o dev local não tem por que herdar essa fragilidade.

**SSE pela :3445 foi validado, não deduzido** — o risco era o proxy a mais bufferizar e
reproduzir o sintoma do §4 (replay em rajada e nada depois). Uma conexão de 95s recebeu
`replay-start`, 20 eventos `message` ao vivo e **2 heartbeats**. Heartbeat atravessando é
exatamente a prova que faltava.

### Qual URL abrir

- **Dev:** `http://localhost:3008` — na máquina onde o `pnpm dev` está rodando.
  Tem que ser `localhost`. Por `127.0.0.1` ou pelo IP `100.x` o browser não trata como origem
  segura e **o modo voz some sem erro** (ver `components/shell/voz.ts`).
- **Produção, o que o Rica usa:** `https://srv1061129.tailfe77db.ts.net:3444`
- **A :3445 ninguém abre no browser.** É o cano do front pro backend; aberta na mão devolve
  JSON cru e parece defeito.

### O que aceitamos junto com isso

Backend único significa que **o front local age na frota de verdade**: clicar em "reiniciar
agente" enquanto se testa um botão reinicia o agente real, com a conversa dele. Construir uma
frota falsa custaria caro pra um cockpit cujo valor é mostrar processo real. Fica o dedo leve
nos botões de ação.
