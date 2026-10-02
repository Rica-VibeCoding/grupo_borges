---
name: mexer-na-pele
description: Mudar cor, espaço, tipografia ou estado visual do Cockpit v2, e varrer hex solto fora do tema. Usar quando o Rica pedir "põe no verde", "aumenta a fonte", ou quando algo destoar do resto.
---

# mexer-na-pele — cor mora em um arquivo só

## A regra

**Toda cor do app está em `app/globals.css`.** Nenhum hex, `rgb()`, `oklch()`,
nome de cor ou `bg-[#123456]` em componente: componente pinta só com
`var(--ck-*)`, inline ou em classe. É o que permite o Rica pedir "põe no verde" e
a mudança acontecer num lugar em vez de quarenta.

## O arquivo tem dois donos

| seção | o que é | dono |
|---|---|---|
| **§A pele** | superfície, texto, estado, diff, borda, escala tipográfica | **Daniel** |
| **§B esqueleto** | espaço, largura, toque, raio, ritmo, camada, safe-area | **Pavan** |

Cor também mora, por ofício, na §B (véu das gavetas, ouro do pulso), na §F
(flutuante), na §T (tropa), nos tons `--ck-tom-*`/`--ck-conversa-*` e na §G
(gaveta) — mapa completo na §2 da estética.

Mudar valor da §A por conta própria é divergência do contrato
(`../../docs/cockpit-v2-estetica.md`) — vira conversa com o Daniel, não edição
local. Adicionar token novo: fala comigo.

## Instrução concreta do Rica é para executar

"Tira o botão", "põe no verde", "aumenta a fonte" — **executa**, mesmo em tom de
"poderia". Opinião contrária entra como sugestão **uma vez**, nunca como override
silencioso.

## Varredura de hex solto

O modo de falha que se repete: alguém resolve rápido com um hex inline e a cor
escapa do tema.

```bash
# hex, rgb() e oklch() fora do globals.css
grep -rnE "#[0-9a-fA-F]{3,8}\b|rgba?\(|oklch\(" \
  --include=*.tsx --include=*.ts . \
  | grep -v node_modules | grep -v "app/globals.css"

# Tailwind arbitrário com cor
grep -rnE "\[(#|rgb|oklch)" --include=*.tsx . | grep -v node_modules
```

O esperado são só os `theme-color`/`manifest` da §10 da estética, shader
(`*-shader.ts`) e comentário; qualquer outra linha é cor escapando. Achou? Troca por token `--ck-*`; se não existe
token para aquilo, o problema é o contrato, não o componente.

## Contraste é piso, não gosto

Ao mexer em cor de texto ou de estado, medir contra `--ck-surface-raised` — a
superfície **mais clara**, portanto o pior caso. Pisos: **7:1** para corpo, **4.5:1**
para texto de estado, **3:1** para borda funcional e indicador.

⚠️ `--ck-text-tertiary` tem 3.55:1 sobre `raised` e **nunca** vai em texto de
corpo. Em texto, só metadado miúdo sobre superfície onde passa 4.5:1 (`canvas`,
gaveta, flutuante); sobre `nav`, `composer` e `raised`, só ícone, separador e
texto ≥ 20px (estética §2 e §9.8).

⚠️ Ao converter OKLCH para hex de cabeça: o browser faz **gamut mapping por
redução de croma** (CSS Color 4), não clamp por canal. Medir por clamp erra para o
lado seguro, então serve de verificação — mas não é o que a tela faz.

## Mexeu no `--ck-surface-canvas`? Mexa no `theme-color` também

O `themeColor` em `app/layout.tsx` e o `manifest.ts` têm de bater com o token
(e a mesa, `#222222`, em `app/page.tsx` e `app/faxina/page.tsx`). Se ficarem
diferentes, a barra do Safari destoa do palco no celular do Rica — e só aparece lá.

## Movimento

Três durações: `--ck-dur-fast` (120ms) para toque/hover/press, `--ck-dur-enter`
(200ms) para entrada e saída de elemento e `--ck-dur-calm` (320ms) para troca de
superfície ou estado. Curvas: `--ck-ease`, `--ck-ease-exit`, `--ck-mola`. Na
Motion, os números espelhados em `gaveta/ritmo-do-historico.ts` e
`shell/troca-de-fileira.ts`. Uma quarta duração é indisciplina.

**Movimento persistente só em estado vivo:** `trabalhando` respira (`ck-respira`),
`aguardando` chama (`ck-chama`, mais forte — o único que pede o Rica), o ponto do
agora respira na gaveta e a bolinha do composer flutua fora do offline.
`prefers-reduced-motion` desliga tudo.
