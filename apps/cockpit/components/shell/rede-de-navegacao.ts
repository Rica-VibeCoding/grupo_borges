/**
 * A REDE DE SEGURANÇA DA NAVEGAÇÃO — e por que ela mordia o dono.
 *
 * Nasceu em 02/08 dentro do `superficie-otimista.tsx`: `router.push` não devolve
 * promessa utilizável, então o jeito de saber se a navegação aconteceu é olhar a
 * URL depois de um tempo. Não mudou? Sai do roteador e apela pro navegador.
 *
 * O DEFEITO (12/08): ela apelava no caminho FELIZ. Duas coisas que só juntas
 * fazem sentido:
 *
 *  1. A URL não muda quando `router.push` é chamado — muda quando a navegação
 *     COMMITA. A doc do Next é explícita: *"the page continues to render the old
 *     URL state until the server navigation completes"*, e `push` é
 *     fire-and-forget dentro de um `startTransition`.
 *  2. A rota do agente é `force-dynamic` e esperava a frota inteira no servidor
 *     — medido em 12/08: de 0,4 s a 10,5 s.
 *
 * Com o limite em 1,2 s, toda navegação mais lenta que isso era lida como falha
 * e virava `window.location.assign` — RELOAD DURO em cima de uma navegação que
 * estava indo bem. É o que o Rica reportava como *"ele pisca, refaz a tela"*, e
 * o que explica *"pus para compactar, depois ele piscou, a compactação sumiu"*:
 * o reload leva junto o texto do composer e a barra de compactação.
 *
 * O CONSERTO é perguntar ao React, não ao relógio. Enquanto a transição está
 * pendente a navegação está EM VOO, e a rede só reexamina — mesmo desenho do
 * `armarPrazoDeRollout` em `lib/usa-envio.ts`, onde o prazo que expira sobre
 * entrega em curso vira nova pergunta em vez de alarme. Só quando a transição
 * terminou E a URL continua a mesma é que a navegação de fato não aconteceu.
 *
 * O timer também passou a ser cancelável: sem isso, cada toque deixava um
 * disparo solto no futuro, e a árvore desmontada não limpava nenhum.
 */

/** Quanto se espera pela navegação antes de PERGUNTAR de novo (não antes de
 *  desistir). Curto porque o custo de reexaminar é ler uma string. */
export const LIMITE_NAVEGACAO_MS = 1_200;

export type DepsRedeDeNavegacao = {
  /** O href de agora. Mudou em relação ao de partida = a navegação commitou. */
  hrefAtual: () => string;
  /** A transição do React ainda está pendente? Lido no instante do exame, nunca
   *  capturado no fechamento — o valor de quando a rede foi armada é sempre
   *  `true` e não diria nada. */
  navegando: () => boolean;
  /** O plano B: tirar a navegação do roteador e dar pro navegador. */
  recarrega: (href: string) => void;
  agendar: (callback: () => void, atrasoMs: number) => number;
  cancelar: (id: number) => void;
  limiteMs?: number;
};

export type RedeDeNavegacao = {
  /** Arma a rede para uma navegação recém-despachada. Cancela a anterior: dois
   *  toques rápidos são uma navegação só do ponto de vista da rede. */
  arma: (href: string) => void;
  /** Desarma. Chamado no desmonte e quando a URL prova que chegou. */
  cancela: () => void;
};

export function criaRedeDeNavegacao(deps: DepsRedeDeNavegacao): RedeDeNavegacao {
  const limite = deps.limiteMs ?? LIMITE_NAVEGACAO_MS;
  let pendente: number | undefined;

  function cancela(): void {
    if (pendente === undefined) return;
    deps.cancelar(pendente);
    pendente = undefined;
  }

  function arma(href: string): void {
    cancela();
    const partida = deps.hrefAtual();

    const confere = () => {
      pendente = undefined;
      // Chegou: a URL commitou. Nada a fazer.
      if (deps.hrefAtual() !== partida) return;
      // Em voo: o React ainda está resolvendo a transição. Perguntar de novo,
      // não recarregar — era exatamente aqui que a rede mordia o caminho feliz.
      if (deps.navegando()) {
        pendente = deps.agendar(confere, limite);
        return;
      }
      // A transição terminou e a URL é a mesma: a navegação não aconteceu.
      deps.recarrega(href);
    };

    pendente = deps.agendar(confere, limite);
  }

  return { arma, cancela };
}

/**
 * Como a URL alcança a tela: empilhando uma entrada no histórico (`push`) ou trocando a de
 * agora (`replace`). A tropa troca, pelo `≡` e tocando fora — ordem do Rica (27/09) de não
 * acumular tela, a mesma do gesto: abrir e fechar a gaveta não pode deixar o voltar do
 * navegador "desvoltando" gaveta. Os outros gatilhos empilham, como sempre.
 */
export function levaAUrl(roteador: { push: (href: string) => void; replace: (href: string) => void }, href: string, substitui: boolean): void {
  if (substitui) roteador.replace(href);
  else roteador.push(href);
}

/**
 * A GAVETA E A TROPA NÃO VÃO AO SERVIDOR (28/09). `?painel=` e `?nav=` só mudam o que o
 * CLIENTE desenha: a visão da gaveta (`VistaDaGaveta`) e as duas superfícies leem a URL
 * pelo `useSearchParams`, e nada no servidor lê esses dois parâmetros. Com `router.push`
 * a página `force-dynamic` refazia o `fetchAgent` e baixava ~33 KB de RSC por toque
 * (medido no dev em 28/09) só para devolver a mesma árvore.
 *
 * O caminho é o History API nativo, que o Next integra ao roteador: *"`pushState` and
 * `replaceState` calls integrate into the Next.js Router, allowing you to sync with
 * `usePathname` and `useSearchParams`"* (docs do Next 16.2.6, linking-and-navigating,
 * "Native History API"). O voltar do navegador fecha a gaveta como antes: a entrada
 * leva a árvore do roteador junto (`copyNextJsInternalHistoryState`) e o `popstate` é
 * tratado pelo Next, sem recarregar.
 *
 * Só vale quando o destino difere do lugar atual APENAS em `painel`/`nav` — mesmo
 * caminho, mesmos outros parâmetros (`tela`, `diag` o servidor lê). Qualquer outra
 * coisa segue pelo roteador, com a rede de segurança armada como sempre.
 */
const SO_DO_CLIENTE = ['painel', 'nav'];

export function soMudaOQueOClienteLe(href: string, atual: string): boolean {
  const aqui = new URL(atual);
  const destino = new URL(href, aqui);
  if (destino.origin !== aqui.origin || destino.pathname !== aqui.pathname || destino.hash !== aqui.hash) return false;
  const resto = (url: URL) => {
    const p = new URLSearchParams(url.search);
    SO_DO_CLIENTE.forEach((chave) => p.delete(chave));
    p.sort();
    return p.toString();
  };
  return resto(destino) === resto(aqui);
}

/** Leva a URL sem servidor quando `soMudaOQueOClienteLe`; devolve se levou. */
export function levaSoNoCliente(
  historia: Pick<History, 'pushState' | 'replaceState'>,
  href: string,
  atual: string,
  substitui: boolean,
): boolean {
  if (!soMudaOQueOClienteLe(href, atual)) return false;
  if (substitui) historia.replaceState(null, '', href);
  else historia.pushState(null, '', href);
  return true;
}
