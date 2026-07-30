---
name: subir-cockpit
description: Sobe, derruba ou reinicia o dev do Cockpit v2 na porta 3008 sem tocar no cockpit do Rica na 3007. Usar sempre que precisar do servidor de desenvolvimento de pé.
---

# subir-cockpit — o dev da 3008, e só ele

## Por que esta skill existe

`pkill next` e `next dev` sem porta **já derrubaram o cockpit da frota**. As duas
instâncias são processos `next-server` com linha de comando parecida, e o Rica usa
a 3007 — quem mata pelo nome do processo mata a dele junto.

Regra da casa: **quem matou sobe.** Se derrubou a 3007, subir de volta antes de
soltar o teclado.

## Subir

```bash
cd /home/clawd/repos/grupo_borges/apps/cockpit
(setsid corepack pnpm dev > /tmp/cockpit-v2-dev.log 2>&1 &)
sleep 8 && ss -tlnp | grep 3008
```

`setsid` importa: sem ele o dev morre quando a sessão que o lançou termina.

## Ver se está de pé

```bash
ss -tlnp | grep -E ':(3007|3008)'      # as duas: 3007 é do Rica, 3008 é sua
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3008/
tail -20 /tmp/cockpit-v2-dev.log
```

## Derrubar — pelo PID DA PORTA, nunca pelo nome

```bash
# 1. descobre quem escuta na 3008 (e SÓ na 3008)
PID=$(ss -tlnp 2>/dev/null | awk '/:3008 /{match($0,/pid=([0-9]+)/,m); print m[1]}' | head -1)
echo "vou matar: $PID"; ps -o pid,cmd -p "$PID"

# 2. confirma que é o certo ANTES de matar
kill "$PID"
```

⚠️ **Nunca** `pkill -f next`, `pkill node`, `killall node`. E matar o `npx`/wrapper
em vez do `next-server` deixa zumbi servindo HTTP 500 na porta.

## Reiniciar

Derrubar (acima) → conferir que a 3008 está livre → subir. Não precisa de restart
para mudança de código: o Turbopack recarrega sozinho. Só é necessário quando muda
`next.config.ts`, `package.json` ou variável de ambiente.

## Orçamento de máquina

**Teto de 2 `next dev` nesta máquina:** a 3007 (do Rica) e a 3008 (sua). Não existe
terceiro — ver `docs/cockpit-v2-ownership.md` §5. Se precisar de um ambiente extra,
é `next build` na Oracle, não um terceiro dev aqui.

## Abrir no navegador

- Local: `http://127.0.0.1:3008`
- Do celular do Rica: **precisa de rota no `tailscale serve`**. A 3443 aponta para a
  3007 e **não se mexe nela**. Rota nova, porta nova.
- ⚠️ Nunca pelo IP `100.x`: origem sem HTTPS não expõe microfone, e o modo voz
  simplesmente não existe lá.
