/**
 * Superfícies otimistas — o toque abre ANTES da navegação voltar.
 *
 * Vale pras DUAS superfícies sobrepostas do celular: o painel de detalhes
 * (direita) e a tropa (esquerda). Nasceu só pro painel em 30/07; a tropa entrou
 * em 02/08, e foi o Rica quem viu, testando: *"a sidebar demora um pouquinho
 * mais para abrir, para começar o movimento — porque ela traz mais dados ou é
 * alguma configuração?"*. Nem uma coisa nem outra: ela era a última superfície
 * ainda esperando o servidor. Medido lado a lado na :3008 (viewport de celular,
 * build de produção): o painel começa a se mover em **271ms**, a tropa em
 * **618ms**, e os 618 são exatamente a ida e volta (a URL chegava em 630ms). Na
 * rede dele, pelo túnel, é a mesma espera de 2,0–2,7s que motivou esta peça.
 *
 * O painel de detalhes mora na URL (decisão nº 1 do `app-shell.tsx`) e a
 * página é `force-dynamic`: medido com Playwright na :3008 (30/07), do clique
 * até o `data-aberto` virar iam **2,0–2,7s** de ida e volta ao servidor, e só
 * então a animação de 200ms do `.ck-surge` corria. O Rica pegou ao vivo:
 * *"demora muito para abrir"*. Nenhum ajuste de duração ou curva do CSS
 * resolveria — a demora era ANTES da animação existir.
 *
 * A saída NÃO é tirar o painel da URL (deep-link do Telegram, refresh e botão
 * voltar do Android continuam valendo). É inverter a ordem dos eventos: como
 * o painel fica SEMPRE montado (commit do `.ck-surge`), o clique vira
 * `data-aberto` no mesmo frame por `useOptimistic`, e o `router.push` rola na
 * MESMA transição só pra URL alcançar a tela. Enquanto a transição está
 * pendente o valor otimista manda; quando o payload chega, a prop do servidor
 * confirma o mesmo valor e nada pisca. Navegação falhou? O otimista reverte
 * sozinho pro valor da URL.
 *
 * Sem JavaScript nada aqui muda: os três gatilhos (botão do chrome, véu e o
 * `×` do painel) continuam `<Link>` de verdade — o `onClick` só existe depois
 * da hidratação, e clique com modificador (ctrl/cmd, abrir noutra aba) passa
 * reto pro comportamento padrão do browser.
 *
 * Quem renderiza fora de um `PainelProvider` recebe `null` do contexto e cai
 * no valor do servidor — o comportamento de antes desta peça, intacto.
 */
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useContext, type CSSProperties, type ReactNode } from 'react';

import { useHrefDoPainel } from './use-href-do-painel';
import { cliqueSimples, painel } from './contexto-da-superficie';

// A fábrica, os providers e a tropa moram ao lado desde 02/10; daqui continuam
// saindo para quem importa `superficie-otimista`.
export {
  NavProvider,
  PainelProvider,
  cliqueSimples,
  usaNavegacaoDaTropa,
  usePainelAberto,
} from './contexto-da-superficie';
export { BotaoNav, GavetaNav } from './superficie-da-tropa';

/** Link de fechar otimista, pros gatilhos que NÃO precisam de `data-aberto`
 *  (o `×` do painel). Fora do provider é um `<Link>` comum. */
export function LinkFechaPainel({
  href: hrefRecebido,
  rotulo,
  className,
  style,
  children,
}: {
  href: string;
  rotulo: string;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  const ctx = useContext(painel.Ctx);
  const href = useHrefDoPainel(hrefRecebido);

  return (
    <Link
      href={href}
      onClick={
        ctx
          ? (e) => {
              if (!cliqueSimples(e)) return;
              e.preventDefault();
              ctx.ir(href, false);
            }
          : undefined
      }
      aria-label={`Fechar ${rotulo}`}
      className={className}
      style={style}
    >
      {children}
    </Link>
  );
}

/** O fechar do `LinkFechaPainel` sem o link: uma ação que termina no chat (a
 *  Nova conversa da gaveta, F16). Fora do provider, o roteador de sempre. */
export function usaFechaPainel(hrefRecebido: string): () => void {
  const ctx = useContext(painel.Ctx);
  const href = useHrefDoPainel(hrefRecebido);
  const router = useRouter();
  return () => (ctx ? ctx.ir(href, false) : router.push(href));
}

/** O irmão de cima, pro lado que ABRE — a cápsula do agente no chrome, único
 *  gatilho visível do painel desde 27/09. Otimista porque `<Link>` seco levaria os 2,0–2,7s
 *  de ida e volta antes de a gaveta começar a se mover, e é essa espera que o
 *  Rica pegou ao vivo. Sem `data-selecionado` de propósito — quem abre não
 *  precisa refletir estado, o gatilho de fechar é o próprio painel. */
export function LinkAbrePainel({
  href: hrefRecebido,
  rotulo,
  className,
  style,
  children,
}: {
  href: string;
  rotulo: string;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  const ctx = useContext(painel.Ctx);
  const href = useHrefDoPainel(hrefRecebido);

  return (
    <Link
      href={href}
      onClick={
        ctx
          ? (e) => {
              if (!cliqueSimples(e)) return;
              e.preventDefault();
              ctx.ir(href, true);
            }
          : undefined
      }
      aria-label={`Abrir ${rotulo}`}
      className={className}
      style={style}
    >
      {children}
    </Link>
  );
}

/** Véu + aside do painel. O conteúdo (`children`) chega pronto do servidor e
 *  permanece montado; o que o cliente faz é virar `data-aberto`/`inert` sem
 *  esperar a navegação. O `inert` virando no mesmo frame também FECHA a
 *  janela em que o conteúdo sumindo continuava alcançável por Tab.
 *
 *  O véu NÃO escurece mais — ordem do Rica (30/07, via Pavan, com prints):
 *  *"tira a função que escurece o resto da tela quando a gaveta/painel
 *  aparece"*. Ele continua existindo só como alvo de clique pra fechar (o
 *  `ck-surge-veu` o esconde com `visibility: hidden` quando fechado, então fora
 *  do painel aberto ele não intercepta nada). Sem a cor, o clique de fora
 *  fechando é o MESMO comportamento de antes — só perdeu o aviso visual. Se
 *  o Rica quiser o fundo INTERATIVO (clicar no chat com o painel aberto,
 *  como na referência), é remover este Link de vez. */
export function GavetaPainel({
  fecharHref: fecharHrefRecebido,
  rotulo,
  aberto,
  children,
}: {
  fecharHref: string;
  rotulo: string;
  /** Valor do servidor — usado no SSR e como fallback fora do provider. */
  aberto: boolean;
  children: ReactNode;
}) {
  const ctx = useContext(painel.Ctx);
  const fecharHref = useHrefDoPainel(fecharHrefRecebido);
  const abertoReal = ctx?.aberto ?? aberto;

  return (
    <>
      {/* O `data-aberto` mora no próprio Link: o seletor do `.ck-surge-veu`
          casa classe E atributo no MESMO elemento — um wrapper em volta
          quebraria a animação de entrada/saída do véu. */}
      <Link
        href={fecharHref}
        onClick={
          ctx
            ? (e) => {
                if (!cliqueSimples(e)) return;
                e.preventDefault();
                ctx.ir(fecharHref, false);
              }
            : undefined
        }
        aria-label={`Fechar ${rotulo}`}
        data-aberto={String(abertoReal)}
        className="ck-surge-veu fixed inset-0"
        style={{ zIndex: 'var(--ck-z-drawer)' }}
      />

      <aside
        aria-label={rotulo}
        onClick={(evento) => evento.stopPropagation()}
        onPointerDown={(evento) => evento.stopPropagation()}
        onPointerUp={(evento) => evento.stopPropagation()}
        data-aberto={String(abertoReal)}
        inert={!abertoReal}
        className="ck-surge ck-flutua flex min-h-0 flex-col overflow-hidden"
        style={{ background: 'var(--ck-surface-nav)' }}
      >
        {children}
      </aside>
    </>
  );
}
