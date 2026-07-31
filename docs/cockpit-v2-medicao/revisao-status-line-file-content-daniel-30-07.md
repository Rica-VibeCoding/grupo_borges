# Revisão cruzada — `status-line` (G4) e `file-content` (G5) do Daniel (30/07 noite)

> Revisor: Hiro. Regra do ownership.md: revisão de frontend é sempre Kimi/Hiro,
> nunca o autor. RELATO, não correção — quem ajusta é o Daniel ou o Pavan.
> Escopo: `components/renderers/status-line.{ts,tsx,test.ts}` (commit `54f630f`)
> e `components/renderers/file-content.{ts,tsx,test.ts}` (commit `a6fdbc7`).
> Régua: `docs/cockpit-v2-estetica.md`, fixtures reais em
> `fixtures/cockpit-v2/familias/`, padrão dos irmãos `fetch-result`/`result-list`/
> `agent-result`. Os dois nascem órfãos de propósito (não plugam no feed —
> território da ramificação é meu).

**Veredito: aprovado com 1 médio, 2 baixos, 4 nits.** Normalizadores estritos,
testes fiéis às fixtures (conferi valor por valor), lição do self-import
aplicada desde o nascimento. O médio é de token de cor; um dos baixos é
questão de padrão que **não nasceu aqui** — nasceu no meu `fetch-result`.

---

## Achados

### 1. MÉDIO · `status-line.tsx` — badges de pin/retomado em `--ck-text-tertiary` (texto de 12px)

`status-line.tsx:35,38`: os badges `→ {pin.name}` e `retomado` usam
`color: 'var(--ck-text-tertiary)'` sobre `text-xs` (12px) do Badge. É a
proibição categórica da §9.8 ("`--ck-text-tertiary` em texto de corpo") e do
próprio token (`globals.css:59`: "⚠️ NUNCA corpo: só ícone, separador, texto
≥ 20px"). Nuance medida: o componente vai renderizar **em canvas** (linha de
execução vive no canvas, §2.6), onde o tertiary dá ~4,8:1 — passa o piso de
label (4,5:1) por pouco. Mas a tabela do doc mede em raised (**3,55:1**,
reprova) e a regra é escrita de forma categórica, não por superfície.
Agravante de contexto: a mesma violação existe no `LinhaSeca`
(`corpo-do-item.tsx:68`, corpo 13px em tertiary — território meu, pré-existente).
Caminho sugerido: `text-secondary` nos dois badges (6,07:1, folgado em
qualquer superfície) — e decidir de uma vez se o `LinhaSeca` entra na mesma
correção, pra terceira cópia não nascer divergente.

### 2. BAIXO · `file-content.tsx` — `ck-veil` sobre `--ck-surface-raised` (letra × raciocínio da §9.11)

`file-content.tsx:72`: o botão "ver tudo" usa `ck-veil` **dentro** do card
`bg-[var(--ck-surface-raised)]` (linha 50); o "copiar" do `CodeBlock` (também
`ck-veil`) fica na mesma situação. A §9.11 como escrita é categórica: "Véu de
interação sobre `--ck-surface-raised`". O raciocínio dela (§2.6), porém, é
derrubar **borda funcional** pra 2,98:1 — e aqui não há borda funcional sob o
véu: os botões são texto sem moldura e a borda do card é `edge-hairline`
decorativa, fora da área do véu. **Não é desvio do Daniel**: o padrão nasceu
no `fetch-result.tsx:53,79` (meu) e o `agent-result.tsx:98,136` (Tara) repete
— ele copiou o irmão fielmente, como devia. Decisão de padrão pro Pavan: ou a
regra ganha a exceção escrita "véu sem borda sobre raised pode", ou se troca o
sinal de hover nos 4 arquivos (mais o `code-block.tsx`). Eu não flaguei isso
na revisão do G7 — registro aqui que o alcance é maior que este arquivo.

### 3. BAIXO · `file-content.ts` — campo `truncated` da fixture MCP real é ignorado

A fixture real `result__content_contentType_isBase64_method_path.json` traz
`truncated: false` — o campo existe no payload de verdade. O normalizador não
lê: se algum dia vier `true`, o cabeçalho mostra "{n} linhas" contando só o
trecho recebido e o "ver tudo" para no corte sem aviso. Caminho: carregar
`truncado` no modelo e ajustar o rótulo ("trecho de N linhas" ou similar).
Hoje é latente (única fixture tem `false`), por isso baixo.

### 4. NIT · `file-content.tsx` — expansão chaveada só pelo caminho

`expandidoPara === dados.caminho`: duas leituras do **mesmo** arquivo no feed
(re-leitura depois de um Edit é o caso comum) compartilham a chave — quando a
virtualização reaproveita a instância, o "expandido" vaza de uma leitura pra
outra (que pode ter conteúdo diferente). O `agent-result` resolveu o mesmo
problema com `chaveDoConteudo` (hash do conteúdo) — caminho+totalDeLinhas já
bastava aqui.

### 5. NIT · `file-content.ts` — contagem de linhas e rótulo de binário nos cantos

- `contarLinhas` conta `'\n'`: arquivo terminando em newline ("a\n") vira 2
  linhas. Cosmético, mas o número vai pro cabeçalho.
- Ramo Read: qualquer `type` ≠ `'text'` vira `binario` — um `type` novo de
  texto (ex.: notebook) cairia no rótulo "Conteúdo binário — não exibido",
  que mentiria. Barato endurecer: binário só quando `type === 'image'` ou
  `content` não é string (a segunda condição já está lá).

### 6. NIT (herdado, padrão) · `text-[13px]` solto × `--ck-text-sm`

Ambos os arquivos novos usam `text-[13px]` (status-line: 1×; file-content: 5×).
É o mesmo nit aberto da revisão do G7 — os irmãos fazem igual e a decisão é
de padrão, do Pavan. Registro só pra contagem ficar completa.

---

## O que conferi e está certo (para não reabrir)

- **Fixtures — valores conferidos um a um contra o JSON real:**
  - G4: `commandName: 'canal-telegram'` ✓; pin `{id/name: 'a2c44a4ca9248dcd0',
    ref: '9de3d4'}` + texto /^Message queued/ ✓; `resumedAgentId:
    'a13ed7dac76527954'` com `pin.id` igual ✓; `success: false` na
    `message_success` ✓ (o teste trava o tom de falha com fixture real, não
    sintético — melhor que o caminho que eu sugeri no G7).
  - G5: Read com `filePath` do canal-telegram SKILL.md e `totalLines: 147` ✓;
    MCP `get_file` com `path: 'FLUYT_UI_REFERENCE.md'` ✓ e o teste documenta
    que a fixture é redigida (placeholder de 1 linha, não os "18996 chars" do
    texto) — quem ler o teste não se confunde.
- **Rejeição cruzada**: `status-line` rejeita as shapes de fetch/lista/agente
  **e a do G5** (`result__file_type`); `file-content` rejeita fetch/lista/
  agente. `method` ≠ `get_file` não casa (teste dedicado). Pin malformado não
  derruba o resto do corpo (teste dedicado).
- **Self-import**: os dois `.tsx` nascem com `./status-line.ts` /
  `./file-content.ts` explícitos — a lição do 500 de ontem aplicada sem
  precisar de incidente. O `import { CodeBlock } from './code-block'` sem
  extensão é seguro: não existe `code-block.ts` irmão.
- **§9.14 (sem highlighter) e conteúdo verbatim**: `CodeBlock` é `<pre>` puro;
  a decisão de **não** passar o conteúdo por `AssistantMarkdown` está
  documentada no cabeçalho e é a correta (`#`/`*` do arquivo virariam
  formatação).
- **Toque e a11y**: "ver tudo" com `min-h-[44px]` + `aria-expanded`; "copiar"
  do CodeBlock com `min-h-[var(--ck-touch-min)]` + `aria-live`. `status-line`
  não tem alvo de toque (correto — é linha de leitura).
- **Tokens**: zero hex cru nos 6 arquivos; `state-ok`/`state-fail` no badge
  principal medidos em canvas: **8,6:1 e 7,1:1** — folgados, e a palavra
  ("ok"/"falhou") acompanha a cor (§9.7 safa). Corpo principal em
  `text-secondary` (8,2:1 em canvas). Bordas `edge-hairline` decorativas, sem
  piso — correto pra moldura.
- **Ramo binário**: placeholder honesto, testado com payload sintético
  **marcado como sintético** no nome do teste — sem fixture real, ninguém
  finge que tem.
- **Nome não colide**: `components/shell/statusline.tsx` (sem hífen) existe e
  é outra coisa — o aviso do dispatch foi respeitado e documentado nos dois
  arquivos.
- **Órfãos de propósito**: nenhum dos dois toca `corpo-do-item.tsx`/
  `execucao-do-item.ts` — a ramificação continua sendo peça minha, em um
  dispatch só.

## Observação (não é achado) — miniatura de imagem × placeholder

A tabela de casos da §9 prevê "miniatura com altura reservada + overlay" pra
`isImage` e "igual, com badge MCP" pra `isBase64`. O `tool_use_result` rico
**não carrega os bytes** da imagem (eles moram no `message.content`, fora do
`rich`), então o placeholder "Conteúdo binário — não exibido" é o que o
pipeline atual sustenta. Se um dia quiserem miniatura de verdade, é decisão de
pipeline (enriquecer o `rich`), não deste renderer. Registro pra quando a
família for plugada.

---

## Suíte e tipos

Suíte completa na árvore atual (pós-`54f630f`): **267/267** (`node --test`,
rodada desta revisão) — o "261/261" do commit do G4 e o "255/255" do G5 são
de antes de testes que entraram depois. `tsc --noEmit` **limpo** (rodada
desta revisão).
