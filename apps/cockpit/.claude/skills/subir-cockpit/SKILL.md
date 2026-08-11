---
name: subir-cockpit
description: Sobe, derruba ou reinicia o dev do Cockpit v2 na porta 3009 sem tocar na produção da 3008 nem no cockpit do Rica na 3007. Usar sempre que precisar do servidor de desenvolvimento de pé.
---

# subir-cockpit — o dev da 3009, e só ele

> **[04/08/2026] O dev mudou de 3008 para 3009.** A 3008 passou a ser ocupada
> pela unit `cockpit-v2.service` (`next start`, build de produção), então o
> `next dev` não cabe mais lá. Todo comando abaixo que dizia 3008 agora diz 3009.

## Por que esta skill existe

`pkill next` e `next dev` sem porta **já derrubaram o cockpit da frota**. As duas
instâncias são processos `next-server` com linha de comando parecida, e o Rica usa
a 3007 — quem mata pelo nome do processo mata a dele junto.

Regra da casa: **quem matou sobe.** Se derrubou a 3007, subir de volta antes de
soltar o teclado.

## Subir

```bash
cd /home/clawd/repos/grupo_borges/apps/cockpit
(setsid env COCKPIT_DIST_DIR=.next-dev npx next dev --port 3009 --hostname 127.0.0.1 > /tmp/cockpit-v2-dev-3009.log 2>&1 &)
sleep 8 && ss -tlnp | grep 3009
```

O `pnpm dev` do `package.json` tem `--port 3008` cravado — por isso o comando é
`npx next dev` com a porta explícita, e não o script.

`setsid` importa: sem ele o dev morre quando a sessão que o lançou termina.

## Ver se está de pé

```bash
ss -tlnp | grep -E ':(3007|3008|3009)'  # 3007 v1 do Rica · 3008 produção v2 · 3009 sua
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3009/
tail -20 /tmp/cockpit-v2-dev-3009.log
```

## Derrubar — pelo PID DA PORTA, nunca pelo nome

```bash
# 1. descobre quem escuta na 3009 (e SÓ na 3009)
PID=$(ss -tlnp 2>/dev/null | awk '/:3009 /{match($0,/pid=([0-9]+)/,m); print m[1]}' | head -1)
echo "vou matar: $PID"; ps -o pid,cmd -p "$PID"

# 2. confirma que é o certo ANTES de matar
kill "$PID"
```

⚠️ **Nunca** `pkill -f next`, `pkill node`, `killall node`. E matar o `npx`/wrapper
em vez do `next-server` deixa zumbi servindo HTTP 500 na porta.

## Reiniciar

Derrubar (acima) → conferir que a 3009 está livre → subir. Não precisa de restart
para mudança de código: o Turbopack recarrega sozinho. Só é necessário quando muda
`next.config.ts`, `package.json` ou variável de ambiente.

## Orçamento de máquina

**Teto de 2 `next dev` nesta máquina:** a 3007 (do Rica) e a 3009 (sua). A 3008
não conta — é `next start`, build pronto, não recompila. Não existe terceiro dev —
ver `docs/cockpit-v2-ownership.md` §5. Se precisar de um ambiente extra, é
`next build` na Oracle.

## Abrir no navegador

- Local: `http://127.0.0.1:3009`
- **O dev não é mais publicado na tailnet.** A `:3444` apontava pro 3009 e o Rica
  a abria todo dia; ele mandou tirar em 08/08 — não quer mais ver trabalho pela
  metade. A única porta dele é a `:3446` (produção, 3008). Quem valida o dev é o
  agente, por `127.0.0.1:3009` ou Playwright.
- A 3443 aponta para a 3007 (v1) e **não se mexe nela**.
- ⚠️ Nunca pelo IP `100.x`: origem sem HTTPS não expõe microfone, e o modo voz
  simplesmente não existe lá.
