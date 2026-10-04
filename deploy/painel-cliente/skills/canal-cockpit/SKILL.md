---
name: canal-cockpit
description: Formato das respostas no painel do cliente (agentes.conectamoveis.net.br), lido quase sempre no celular. Cobre conclusão na primeira tela, alertas coloridos, blocos copiáveis, anti-parede e anexos. Usar em toda mensagem vinda do painel, inclusive após compactação; o gancho do painel dispara uma vez por sessão.
---

# Canal Cockpit (painel do cliente)

A resposta sai pela saída normal, nunca por `mcp__plugin_*__reply`. O cliente lê no celular, então a **primeira tela decide**: conclusão, resultado ou decisão pedida vem antes de tudo. Corta introdução, bastidor, repetição e despedida. Não corta prova, ressalva nem próximo passo.

Quem lê não é técnico: escreva para o dono do negócio. Termo técnico só quando ele precisar usar, e com explicação curta na primeira vez.

## Tamanho pelo tipo

- **Pergunta:** 1 a 3 linhas, sem relatório nem seções.
- **Execução:** resultado, evidência mínima, próximo passo.
- **Decisão:** até 3 opções, a recomendada primeiro, a pergunta no fim.
- **Bloqueio:** um alerta, a causa e a ação exata que o cliente precisa fazer.

Em trabalho longo, andamento só quando muda o achado, o risco ou o bloqueio: uma frase, sem narrar comando. A resposta final se sustenta sozinha, porque o andamento fica recolhido.

## Alertas

`> [!NOTE]` azul · `> [!TIP]` verde · `> [!IMPORTANT]` roxo · `> [!WARNING]` amarelo · `> [!CAUTION]` vermelho

- O marcador vai na **primeira linha** da citação. No meio do texto, não vira alerta.
- O painel traduz o rótulo sozinho.
- No máximo um alerta, salvo riscos independentes, e só se muda decisão, risco ou urgência.

## Anti-parede

- Até 5 linhas: frase-gancho em negrito (ex.: **Mas tem uma ressalva**). Mais que isso: `##` ou `###`, com linha em branco entre seções e `---` entre blocos longos.
- Item de lista em uma linha, até cerca de 15 palavras. Negrito só na palavra-chave.
- Tabela só para comparar os mesmos campos entre itens. Na célula de status, ✅ ou ⚠️.
- Emoji só como estado (🔴 🟡 🟢 ✅ 💡 📌) ou como ícone de campo em lista campo→valor, por exemplo 📦 **Pedido:** 1042.
- Link como `[texto](url)`. Fala do cliente citada como `> "..."`.

## Copiável

- Texto que o cliente vai copiar (mensagem pronta, endereço, código, número) vai num bloco cercado, um por bloco, sem prosa dentro.
- O que o bloco faz ou para que serve, em uma frase, antes dele.
- Nome de arquivo, número de pedido e código curto em código embutido.

## Entrada

- Começa com `🎙 `: é transcrição do ditado, pode ter erro de reconhecimento. Ler pelo sentido.
- `Imagem enviada via cockpit: <caminho>`: ler o arquivo antes de responder. A legenda é contexto.

## Decisão do cliente

Decisão que bloqueia, confirmação de ação que não tem volta ou escolha entre caminhos: pergunte no fim da resposta, em uma linha, com as opções numeradas. Não use `AskUserQuestion`: o painel não mostra.

Exemplos antes/depois, para validar formato: `references/formato-visual.md`.
