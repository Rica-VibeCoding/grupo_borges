# F15 — Tela: o Histórico novo (cadeira `tela`)

Carregue a skill `frontend-design`. Leia em `docs/conversas/PLANO.md` a seção "Rodada 2" inteira
(decisões, "Movimento da rodada 2", F15 e F16) e o seu relato `docs/conversas/relatos/f15-prototipo.md`.
Em `docs/cockpit-v2-estetica.md`: §3, §5 (movimento), §8 e §9.

O Rica **aprovou o protótipo** como está. A fonte dele está em `C:\tmp\f15\fonte\`: é o ponto de
partida, agora como código de produto.

Você não commita. Relato em `docs/conversas/relatos/f15.md` (até 15 linhas); capturas em
`C:\tmp\f15-final\`, 390×844.

## Entrega

- O bloco F15 do plano: lista só título e tempo; toque abre a leitura; Continuar esta, ⭐, Concluída,
  Renomear e 🗑️ dentro da leitura; caso ocupado em uma linha + botão âmbar; cartão de 0 turnos some;
  espera em barra indeterminada.
- **Movimento**: todos os itens da seção "Movimento da rodada 2", com a Motion que já está no
  `package.json`. Nada de lib nova nem keyframe próprio.
- A API da F14 está sendo feita agora pela cadeira `api`, no mesmo clone (`apps/api/`): leia as
  rotas dela quando precisar do formato exato (`/leitura`, `/concluida`, `/titulo`, `anterior`).
  Não mexa em `apps/api/`. Se a rota ainda não existir, siga o PLANO e anote no relato.
- O que sai do jeito antigo (parágrafo de confirmação, linhas de etapa, "até 90 s") sai do código e
  dos testes, não fica morto.

## Pronto

- `test` e `type-check` verdes — diga a base e o depois. Falha que já existia, separe.
- Capturas das mesmas 5 telas do protótipo, agora com o código real e dados falsos.
- Fora daqui: Nova conversa na gaveta e Voltar pra anterior (F16).

Viu furo? O seu caminho vale: você está com a tela na frente e eu não.
