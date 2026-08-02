# Prazo de confirmação POST → eco

Medição em 30/07/2026. Ela mostrou que 3.000 ms cobriam 200/200 confirmações na
janela que o redutor cronometra (`200` → eco), mas foi superada pela evidência de
produção de 02/08: com o agente ocupado e a saída do pane rolando, o eco não foi
observado nessa janela e o falso negativo induziu um envio duplicado. O prazo
operacional passa a **12.000 ms**; estouro significa `nao-confirmado`, nunca falha.

## 1. Distribuição observada

Percentis por *nearest rank*, em milissegundos:

| relógio | caminho | n | mediana | p95 | p99 | pior |
|---|---:|---:|---:|---:|---:|---:|
| início do POST → item `user` recebido no SSE | texto | 100 | 702 | 861 | 1.031 | 1.611 |
| início do POST → item `user` recebido no SSE | voz | 100 | 3.342 | 4.382 | 5.057 | 6.062 |
| início do POST → item `user` recebido no SSE | combinado | 200 | 1.611 | 4.044 | 4.648 | 6.062 |
| resposta `200` → item `user` recebido no SSE | texto | 100 | 432 | 494 | 740 | 977 |
| resposta `200` → item `user` recebido no SSE | voz | 100 | 405 | 567 | 826 | 1.434 |
| resposta `200` → item `user` recebido no SSE | combinado | 200 | 422 | 554 | 826 | 1.434 |

Período da amostra ao vivo: **30/07/2026 15:49:44–15:57:39 BRT**. Foram
200 envios sequenciais contra o agente descartável `canario`: 100 textos e 100
áudios, todos com eco confirmado e todos com `event_id > event_boundary_id`.
O p99 tem o piso mínimo útil de 100 pontos por caminho: é o segundo pior valor
observado, não uma estimativa robusta de eventos de uma-em-dez-mil.

### Por que o corpus histórico não virou amostra POST → eco

O banco de produção foi aberto com URI SQLite `mode=ro`. Ele contém **150.751
eventos**, ids 18.384–520.436, de **11/05/2026 20:02:04 a 30/07/2026
15:39:30 BRT**, incluindo 35.626 `jsonl:user`. Entretanto, a tabela registra o
eco e seu timestamp em milissegundos, mas não registra o instante, o corpo, a
rota ou a chave de idempotência do POST. O access log antigo registra a rota,
mas não horário, corpo nem `event_boundary_id`. Portanto o número de pares
históricos auditáveis é **zero**; parear cada POST com “o próximo user” seria
inventar causalidade.

Consulta usada no corpus:

```sql
-- conexão:
-- sqlite3 'file:apps/api/db/grupo_borges.db?mode=ro'

SELECT count(*), min(id), max(id),
       datetime(min(created_at), 'unixepoch', 'localtime'),
       datetime(max(created_at), 'unixepoch', 'localtime')
FROM task_events;

SELECT kind, count(*)
FROM task_events
GROUP BY kind
ORDER BY count(*) DESC;

SELECT id, agent_slug,
       json_extract(payload, '$.timestamp') AS echo_timestamp,
       json_extract(payload, '$.sessionId') AS session_id,
       json_extract(payload, '$.uuid') AS uuid,
       json_extract(payload, '$.message.content') AS content
FROM task_events
WHERE kind = 'jsonl:user'
ORDER BY id;
```

Não existe coluna/JSON path nessa consulta que forneça o timestamp do POST.

### Como a amostra ao vivo foi medida

O `cockpit-api.service` **não foi reiniciado**. Como o processo vivo ainda era
anterior ao commit e não devolvia a fronteira, subi uma API temporária em
`127.0.0.1:8011`, com banco temporário e workspace isolado. Foram usados o código
atual de produção, o `JsonlWatcher`, SQLite, o endpoint SSE real e uma conexão
SSE persistente. O banco original permaneceu read-only.

Para cada amostra:

1. relógio monotônico imediatamente antes do POST;
2. `POST /api/agents/canario/input` ou `/voice`;
3. captura do instante da resposta HTTP;
4. espera pelo item `user` de texto correspondente, posterior à
   `event_boundary_id`, na conexão
   `GET /api/agents/canario/messages/stream`;
5. captura do relógio monotônico ao receber o frame SSE;
6. interrupção da resposta do canário e só então a amostra seguinte, evitando
   fila entre amostras.

A medição inclui `send_message`, watcher, escrita no SQLite e polling de 250 ms
do SSE. Não inclui a rede Tailscale servidor → aparelho, pois o cliente de
medição rodou no mesmo host.

## 2. Cobertura dos 3.000 ms

O redutor arma o timer **depois da resposta do POST**, ao publicar `aceitar` e
gravar `aceitoEmMs` (`usa-envio.ts` → `armarPrazo`; `envio.ts` →
`tempo-passou`). Nessa janela correta:

| caminho | cobertos em 3.000 ms | pendurados falsos |
|---|---:|---:|
| texto | 100/100 = **100%** | 0/100 = **0%** |
| voz | 100/100 = **100%** | 0/100 = **0%** |
| total | 200/200 = **100%** | 0/200 = **0%** |

Se alguém iniciar os mesmos 3.000 ms no começo do POST, o resultado muda:

| caminho | cobertos em 3.000 ms | envios legítimos cortados cedo |
|---|---:|---:|
| texto | 100/100 = **100%** | 0/100 = **0%** |
| voz | 18/100 = **18%** | 82/100 = **82%** |
| total | 118/200 = **59%** | 82/200 = **41%** |

Logo, 3.000 ms não é um prazo aceitável para a operação inteira de voz, mas
**é** suficiente para a confirmação observável depois que o backend aceita o
envio. Hoje o código usa a segunda semântica.

## 3. Voz e texto

**São distribuições diferentes no POST completo e semelhantes na espera do
eco.** A duração do POST de voz, dominada por STT, teve mediana 2.978 ms, p95
3.888 ms, p99 4.628 ms e máximo 4.669 ms. No texto, a duração do POST teve
mediana 254 ms, p95 458 ms, p99 627 ms e máximo 633 ms.

Depois do `200`, voz teve mediana 405 ms contra 432 ms do texto; p99 826 contra
740 ms. O pior de voz foi maior (1.434 contra 977 ms), mas ambos ficaram muito
abaixo de 3.000 ms. A suspeita sobre STT estava correta para latência percebida
total, mas não para o prazo do estado `aceito`, porque o STT termina antes
desse estado nascer.

Isso pede **dois conceitos de UI**, não necessariamente dois prazos de
confirmação:

- voz durante upload/STT continua em `enviando`;
- só depois da resposta entra em `aceito` e começa a espera do eco.

## 4. Recomendação atualizada após o incidente de 02/08

**Usar 12.000 ms para `aceito` → `nao-confirmado`.** Motivos:

- é 8,3× o pior caso local observado de 1.434 ms;
- cobre melhor o cenário ausente da amostra: agente ocupado, pane rolando,
  Tailscale e navegador móvel;
- ainda limita a espera a 12 s antes de devolver a decisão ao Rica;
- mantém o contrato conservador: sem eco, o painel não diz que enviou e também
  não afirma o oposto.

Os 3.000 ms continuam documentados acima como resultado da amostra, não como
configuração recomendada. O incidente real mostrou que ajustar o produto apenas
ao máximo de uma rodada local era margem insuficiente.

### Amostra bruta (ms, ordem de coleta)

`POST → eco`, texto (n=100):

```text
588,674,718,691,719,704,705,690,703,716,702,703,454,443,706,696,861,1611,1031,987,1017,966,727,698,707,708,692,702,451,706,687,454,451,721,667,700,702,703,692,711,671,708,685,450,697,707,442,452,698,761,767,699,449,704,454,702,735,673,450,721,696,704,699,730,727,696,709,741,445,728,704,769,707,706,707,801,659,448,743,681,691,703,709,453,702,715,698,451,705,703,463,449,729,708,451,449,452,452,444,450
```

`200 → eco`, texto (n=100):

```text
352,418,446,457,473,435,438,448,448,455,447,371,238,212,474,445,246,977,573,482,740,339,388,437,467,413,473,467,233,476,453,224,223,484,378,424,485,449,437,494,415,427,353,240,478,413,225,237,484,341,439,442,239,468,215,456,432,456,225,377,430,482,472,515,448,422,426,470,216,390,338,296,403,450,442,485,376,227,440,382,434,450,451,232,473,424,437,237,464,451,206,235,506,387,232,230,200,245,228,228
```

`POST → eco`, voz (n=100):

```text
3773,2714,3220,3482,4580,3492,3723,3010,2968,6062,3815,3228,5057,3288,3270,4541,2725,3500,3236,3261,2987,3797,2968,4044,4382,3786,3841,4648,4269,3285,2726,2774,3475,3280,2991,4036,3479,3246,3342,3289,3712,4315,3264,4025,2991,4037,4031,2765,2701,3342,3837,3582,3280,3061,3066,3615,3695,3295,3489,2990,3007,3269,3498,3011,3264,3567,3840,3720,3016,2997,2750,3262,3308,4060,3614,3532,3778,2994,3555,3561,4096,3572,3017,3544,3192,3336,3767,3806,3611,3889,3314,3513,3752,3011,2743,3024,2732,3250,2754,4006
```

`200 → eco`, voz (n=100):

```text
459,407,258,260,345,433,361,435,255,1434,663,279,388,392,373,290,396,318,338,315,286,248,434,468,826,564,367,528,505,533,462,395,430,271,273,257,403,430,471,335,599,427,334,311,420,437,432,331,334,478,452,389,493,299,453,469,491,418,418,258,422,355,405,356,346,511,614,444,397,411,356,328,370,567,420,554,240,366,360,298,431,469,430,518,386,361,452,377,327,466,405,521,472,509,306,467,452,344,491,282
```
