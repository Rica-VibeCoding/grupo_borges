# F15 — Protótipo do Histórico novo (cadeira `tela`)

Carregue a skill `frontend-design` antes de desenhar.

Leia em `docs/conversas/PLANO.md` só a seção "Rodada 2" (decisões 1–8 e os blocos F15 e F16).
Em `docs/cockpit-v2-estetica.md`, as §3 (contraste), §9 (proibições) e §17 (a gaveta).

Você não commita e **não escreve código de produto**: o Rica aprova o protótipo no celular antes.
Protótipo descartável, montado com as peças e os tokens reais, fora do diff (`git status` limpo
fora do relato). Relato em `docs/conversas/relatos/f15-prototipo.md` (até 15 linhas); capturas
em `/tmp/f15/`, 390×844.

## O que o Rica disse da tela de hoje

"Bater o olho e já saber o que fazer." A F13 está carregada: texto demais, parágrafo de aviso em
toda troca, e tocar numa conversa para espiar já troca o agente de conversa. Ele abriu a errada,
teve de voltar, e o agente reprocessou tudo duas vezes.

## A tela de hoje (fonte canônica, `main`)

- `apps/cockpit/components/gaveta/painel-de-conversas.tsx` (a visão `?painel=conversas`),
  `linha-de-conversa.tsx`, `cartao-em-uso.tsx`, `filtros-de-conversa.tsx`,
  `acao-de-conversa.tsx`; textos da confirmação em `acoes-de-conversa.ts`
  (`textoDaConfirmacao`). Peças em `pecas.tsx`, tokens na §G do `globals.css` (`.ck-gv`).

## Capturas que o Rica vai ver (uma por arquivo, nesta ordem)

1. `1-lista.png`: lista só título e tempo; filtros *Todas* / *⭐* / *Concluídas*; busca.
   Sem o cartão "Em uso agora" quando a atual tem 0 turnos.
2. `2-leitura.png`: tocou numa conversa — últimas mensagens, a nota, e embaixo **Continuar
   esta**. ⭐, Concluída, Renomear e 🗑️ aqui dentro, discretos.
3. `3-ocupado.png`: Continuar esta com o agente no meio de um turno — uma linha
   ("José Pavan está trabalhando") e o botão laranja. Nada de parágrafo.
4. `4-espera.png`: a troca em andamento como uma barra, sem etapas nem "até 90 s".
5. `5-nova-vazia.png`: a conversa nova vazia com o atalho **Voltar pra anterior** (sem repetir a
   foto do agente: a pílula do alto já mostra) e o botão **Nova conversa** na gaveta, ao lado da
   porta do Histórico.

Dados falsos seguindo o contrato (uns 8 itens, tempos "3h", "ontem"). Uma direção só, a sua
melhor; se tiver uma segunda que valha, mande junto com o porquê em uma linha.

Achou que o plano atrapalha a tela? Escreva no relato: seu olhar vale, você está com a tela na
frente.
