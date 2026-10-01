# F8 — Tela: direções visuais (cadeira `tela`)

Carregue a skill `frontend-design` antes de desenhar.

Leia em `docs/conversas/PLANO.md`: "O pedido", "Decisões", o bullet "Gaveta do agente — UI NOVA"
e o "Contrato da API". Em `docs/cockpit-v2-estetica.md`, só a §17 "A gaveta hoje (01/10)" e as
§3 (contraste) e §9 (proibições).

Você não commita e **não escreve código de produto**: o Rica escolhe a direção primeiro. O relato
vai em `docs/conversas/relatos/f8.md` (até 15 linhas); as capturas, em `/tmp/f8/`.

## A tela de hoje (fonte canônica, commit `dfd2dc4`)

- `apps/cockpit/components/gaveta/gaveta-nova.tsx` monta: cabeçalho de uma linha · Conversa
  (ajustes da tela de voz, só aberta por ela) · Sessão · Motor e conta · MCPs.
- Peças em `components/gaveta/pecas.tsx` (`Cartao`, `Bloco`, `Interruptor`, `Segmentado`,
  `Pilula`, `BolinhaDeAlerta`, `Mais`); tokens na §G do `apps/cockpit/app/globals.css`, escopados
  em `.ck-gv`. Cor tem dono: laranja só no anel do retrato, azul só no "ligado", vermelho só no
  "!" de alerta.
- A porta dos MCPs (`gaveta-nova.tsx:252`, `Cartao` + `LinkDaGaveta` para `?painel=mcps`) é o
  molde de porta para outra visão. A visão nova será `?painel=conversas` na `VistaDaGaveta`
  (`components/shell/vista-da-gaveta.tsx:23`).

## Entrega

2 ou 3 direções, cada uma com captura em 390×844 (iPhone) **montada com os tokens e as peças
reais** — protótipo descartável que não entra no diff (ao terminar, `git status` limpo fora do
relato). Dados falsos seguindo o contrato: uns 8 itens, com título, nota, tempo relativo
("3h", "ontem"), ⭐, ⚠️ (com número) e 🔒.

Cada direção mostra:

1. **A porta** na `GavetaNova`: onde fica e como se chama. Dois limites: a gaveta continua
   cabendo sem rolar em 390×844, e o nome não pode confundir com o cartão "Conversa" de voz.
2. **A lista**: filtros *Todas* / *⭐ Especiais* / *⚠️ Com pendência*, busca, e as linhas.
3. **As ações**: Retomar, Nova conversa e Excluir; o item 🔒 sem botões.
4. **A confirmação de Retomar** ("vai interromper o que está rodando") e o estado de espera
   ("estacionando…", "religando…").

No relato: uma linha por direção com a ideia e o porquê, e qual você recomenda. Achou que o
contrato ou o plano atrapalham a tela? Escreva — seu olhar vale, você está com a tela na frente.
