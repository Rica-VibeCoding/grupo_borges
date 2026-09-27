# Fase 3 — freio sempre e folga antes de fechar o turno (cadeira `ui`)

Pedido do Rica, 27/09 manhã: "Então já corrija agora." Os dois achados dos seus relatos.

## 1. Frear sempre
A coordenação está consertando o servidor em paralelo: `POST /interromper` passa a limpar o pedido que o
Claude Code devolve à caixa quando o Escape chega antes da primeira linha — só se o texto devolvido for o
último que o cockpit entregou àquela sessão (prova de posse, o mesmo critério do C-u do envio). A resposta
ganha `{"parado": bool, "pedido_limpo": bool}`.
- Tire a restrição `freiaNoServidor` (`toque-da-conversa.ts`): parar em `esperandoZe` freia sempre.
- Nada mais muda no cliente; o 409/`uncertain` seguinte já é tratado por `envio-da-conversa.ts`.
- O E2E "parar esperando antes da resposta" passa a exigir: `interromper` 200, o `canarinho` volta com a caixa
  vazia (o envio seguinte entra), e a resposta não chega depois. **Só rode esse caso depois que a coordenação
  avisar que o servidor novo está no ar** — sem ele o canarinho trava de novo (e aí avise, não destrave).

## 2. Folga antes de fechar o turno (os ~200 ms de microfone)
Seu relato: a resposta vem gravada em duas linhas, em lotes diferentes; a primeira (vazia, com o fim) chega
antes do texto, a tela vai para "ouvindo", abre o microfone ~200 ms e só então fala. No iPhone, abrir e
fechar o microfone logo antes da voz é suspeito de travar o áudio.
- Teste que reproduz primeiro (puro, em `passosDoZeDepoisDe` ou na máquina).
- Uma folga curta (proponha o número, medido nos E2E) antes de fechar um turno em que o Zé ainda não disse
  nada; texto chegando dentro dela entra no mesmo turno. Turno que já falou fecha como hoje.

## Limites e fecho
Como `fase3-toque.md`. `npm test`, `type-check`, E2E do toque e da fase 2 em Fio e Matéria, relato curto.
Sem commit. Última linha: `FIM-DO-FREIO`.
