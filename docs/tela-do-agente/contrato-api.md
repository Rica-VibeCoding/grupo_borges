# Tela do agente — contrato para a UI

Backend na VPS, **um worker**, montado em `/api/tela-agente`; identidade Tailscale
igual ao resto da API. No front use caminhos relativos pelo rewrite existente.
SSE + POST: a [doc de rewrites do Next](https://nextjs.org/docs/app/api-reference/config/next-config-js/rewrites)
descreve proxy HTTP, sem garantir upgrade WS; a consulta ao código via Context7
mostrou caminhos de upgrade distintos. Não precisamos depender deles.

## Entrada em Abertos

`GET /api/tela-agente/chromes` → lista `{id, maquina, rotulo}`. `id` é
**BH_MAQUINA**, por exemplo `campanha-arsenal`; não é PID, item de Abertos nem target CDP.
Cruze `maquina` + `rotulo` com Abertos, só `grupo=agente`. Não faça correspondência
aproximada: rótulo desconhecido/ambíguo não oferece a ação. As portas vêm do `bh.sh`.
A lista é cadastro, não sonda disponibilidade; abrir pode retornar 502.
Rota da UI a implementar: **`/maquinas/{maquina}/chrome/{chrome}`**, por exemplo
`https://borges.tailfe77db.ts.net:3446/maquinas/arsenal/chrome/campanha-arsenal`.

## Ver, assumir e devolver

Ver **sem assumir é permitido**, sem lock e sem trazer janela para frente.
Só uma tela por Chrome, inclusive observador (evita screencasts conflitantes).

1. `POST /chromes/{chrome}/sessoes` (sem corpo) → 201
   `{id, chrome, aba, inatividade_s:180, sem_fluxo_s:20}`. Guarde `id` em memória.
2. Conecte `EventSource('/api/tela-agente/sessoes/'+id+'/quadros')`.
   Evento `quadro`: `{id, aba, jpeg, largura, altura, viewport:{largura,altura}}`.
   `jpeg` é base64, use `data:image/jpeg;base64,${jpeg}`. `id` do quadro é string.
   Evento `estado`: `{assumido, aba}` a cada ~2s sem imagem; comentário ping a cada 5s.
3. `POST /sessoes/{id}/assumir` → `{controle}`. Só funciona com SSE conectado.
   Guarde o token em memória; mande `X-Tela-Controle: <controle>` nas entradas e Devolver.
4. `POST /sessoes/{id}/devolver` → `{devolvido:true}`. Libera posse e mantém a visualização.
5. Ao sair: `DELETE /sessoes/{id}` → `{encerrada:true}`; feche também o EventSource.

Assumir pega os **mesmos locks do bh.sh**: flock VPS e, no Linux remoto, o flock
que as invocações locais usam; no PC também a pasta em `%TEMP%` e sua renovação.
Ocupado retorna **409**, sem tomar posse à força. Outra identidade recebe 403.
Devolver invalida o token. Sem entrada por **180s**, sem fluxo por **20s**, queda CDP,
fechamento da conexão ou encerramento da API: fecha a sessão e solta a trava.
SSE/heartbeat não contam como atividade humana. Processo morto fecha pipe/locks;
a trava PC usa também o mecanismo de dono/expiração já existente no harness.

No `onerror`, feche o EventSource, desabilite entrada e reabra uma sessão: não use
reconexão automática para continuar com token antigo. 410 significa sessão encerrada.
Uma resposta 200 de entrada confirma CDP, **não** o efeito final do site.

## Entrada (JSON)

`POST /sessoes/{id}/entrada` com token → `{entregue_cdp:true}`.

- Clique/toque: `{tipo:"clique", quadro:"7", x:0.3, y:0.4}`.
  Coordenadas normalizadas **dentro da imagem**, excluindo bordas/faixas de `object-fit`;
  `0 ≤ x,y < 1`. Backend escala para viewport CSS do quadro, inclusive zoom.
- Rolar: `{tipo:"rolagem", quadro:"7", x:0.5, y:0.5, delta_y:300, delta_x:0}`.
  Deltas em pixels CSS, positivo para baixo/direita, limite ±3000 por evento.
- Digitar: `{tipo:"texto", texto:"Olá"}` — `Input.insertText`, até 4096 caracteres.
- Tecla: `{tipo:"tecla", tecla:"Enter"}`; também `Tab` e `Backspace`.
- Trocar aba: `{tipo:"aba", aba:"<target-id>"}`. Lista em
  `GET /sessoes/{id}/abas` → `[{id,titulo,url}]`. Só trocar exige posse.

Não envie entrada antes de receber quadro; use o id **da imagem exibida**.
Quadro de outra aba, viewport alterado ou histórico com mais de 10s: 409, espere
imagem nova. A imagem mais recente permanece válida em página estática.
Troca de aba limpa coordenadas antigas. Mudança de visibilidade reavalia a aba ativa;
se todas estiverem ocultas/minimizadas, encerra com liberação da posse.
Não há arraste, barra de endereço, upload ou captura de janela nativa nesta etapa.

JPEG qualidade 45, lado máximo 960px, teto 2 quadros/s. ACK de todos os quadros CDP,
fila de tamanho 1; rede lenta descarta intermediários. Página estática não gera
quadros repetidos. Medido em campanha/Arsenal: 126165 bytes SSE em 11,54s
(**10934 bytes/s**, ~87 kbit/s), incluindo clique/navegação e alteração visual.
Não é teto universal de bytes: depende da imagem. Erros HTTP: 403 posse/identidade,
404 Chrome/aba desconhecido, 409 ocupado/quadro inválido, 410 sessão morta,
422 corpo inválido, 502 Chrome/túnel indisponível. Erro após abrir SSE encerra o fluxo.
