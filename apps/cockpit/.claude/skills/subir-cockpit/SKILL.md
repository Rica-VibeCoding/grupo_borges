---
name: subir-cockpit
description: Sobe, derruba ou reinicia o dev do Cockpit v2 na porta 3009 sem tocar na produção da 3008. Usar sempre que precisar do servidor de desenvolvimento de pé — na borges ou no notebook do Rica.
---

# subir-cockpit — o dev da 3009, e só ele

> **[04/08/2026] O dev mudou de 3008 para 3009.** A 3008 passou a ser ocupada
> pela unit `cockpit-v2.service` (`next start`, build de produção), então o
> `next dev` não cabe mais lá. Todo comando abaixo que dizia 3008 agora diz 3009.

## Por que esta skill existe

`pkill next` e `next dev` sem porta **já derrubaram o cockpit da frota**. Na
`borges`, o dev e a produção (3008, a única tela do Rica) são processos
`next-server` com linha de comando parecida — quem mata pelo nome do processo mata
a produção junto. (O v1 na 3007 está fora do ar desde a mudança pra `borges`.)

Regra da casa: **quem matou sobe.** Se derrubou a 3008, subir de volta antes de
soltar o teclado (`systemctl --user restart cockpit-v2`, como `clawd`).

## Subir

```bash
cd "$(git rev-parse --show-toplevel)/apps/cockpit" || exit 1   # borges: /home/clawd/repos/grupo_borges · notebook: ~/Projetos/grupo_borges
(setsid env COCKPIT_DIST_DIR=.next-dev npx next dev --port 3009 --hostname 127.0.0.1 > /tmp/cockpit-v2-dev-3009.log 2>&1 &)
sleep 8 && ss -tlnp | grep 3009
```

O `pnpm dev` do `package.json` roda o mesmo comando. A linha acima só acrescenta
`setsid` e o log em arquivo; mantê-la literal, porque
`lib/configuracao-operacional.test.ts` a confere.

No notebook o dev precisa do `.env.development.local` apontando pra API da
`borges` (copiar de `.env.development.example`; ver `docs/cockpit-v2-stack.md` §10).

`setsid` importa: sem ele o dev morre quando a sessão que o lançou termina.

## Ver se está de pé

```bash
ss -tlnp | grep -E ':(3008|3009)'  # 3008 produção v2 (só na borges) · 3009 sua
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

**Na `borges`, um `next dev` só: a 3009.** A 3008 não conta — é `next start`,
build pronto, não recompila — e a 3011 é o preview de branch `ideia/*`, quando há
um. Não suba um segundo dev ao lado da produção. A `borges` é a Oracle **e** a
produção: build extra lá só em estágio (`docs/cockpit-v2-stack.md` §2). No
notebook, só a 3009, com a API vindo da `:3445`.

## Abrir no navegador

- Local: `http://localhost:3009` — voz exige origem segura (`docs/cockpit-v2-stack.md`
  §10); `curl` pode seguir em `127.0.0.1:3009`.
- **O dev não é mais publicado na tailnet.** A `:3444` apontava pro 3009 e o Rica
  a abria todo dia; ele mandou tirar em 08/08 — não quer mais ver trabalho pela
  metade. A única porta dele é a `:3446` (produção, 3008). Na `borges`, quem valida
  o dev é o agente, por curl. No notebook dele o dev roda na máquina que ele usa, e
  aí `localhost:3009` abre direto.
- ⚠️ Nunca pelo IP `100.x`: origem sem HTTPS não expõe microfone, e o modo voz
  simplesmente não existe lá.
