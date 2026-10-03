/**
 * A CHAVE DE MODO — lida aqui e só aqui.
 *
 * O mesmo `apps/cockpit` compila em dois produtos: a FROTA (o cockpit do Rica,
 * padrão) e o painel do CLIENTE (um agente só, atrás do portão de
 * `apps/api/painel_portao.py` — `docs/produto-painel-cliente.md`). A escolha é
 * de BUILD: `NEXT_PUBLIC_COCKPIT_MODO=cliente` no `next build`/`next dev`. O
 * prefixo `NEXT_PUBLIC_` é o que faz o Next gravar o valor no bundle do
 * navegador e do servidor ao mesmo tempo — sem ele o servidor saberia o modo e
 * o cliente não, e a hidratação divergiria.
 *
 * Qualquer valor diferente de `cliente` (inclusive ausente) é FROTA: a tela do
 * Rica não depende de ninguém lembrar de exportar nada.
 *
 * Componente não lê `process.env`: lê `PECAS`. Cada corte é uma peça com nome,
 * e a tabela inteira mora em `pecasDo` — é o que o teste confere nos dois modos.
 */
export type ModoDoCockpit = 'frota' | 'cliente';

export function leModo(valor: string | undefined): ModoDoCockpit {
  return valor === 'cliente' ? 'cliente' : 'frota';
}

// Referência literal: o Next só substitui `process.env.NEXT_PUBLIC_*` escrito
// por extenso, nunca por índice dinâmico.
export const MODO: ModoDoCockpit = leModo(process.env.NEXT_PUBLIC_COCKPIT_MODO);

export const MODO_CLIENTE = MODO === 'cliente';

/** O que cada modo desenha. `true` = a peça existe. Recorte aprovado pelo Rica
 *  para o cliente (03/10): fica o chat, a voz, o feed, as Conversas, a cota e o
 *  ciclo de vida; sai o que é da frota ou mexe no motor. */
export type Pecas = {
  /** Início (`/`), a tropa (faixa, `≡`, arrasto do chat que a abre). */
  tropa: boolean;
  /** `/faxina`. */
  faxina: boolean;
  /** Delegações vivas no feed (`/api/delegacoes`). */
  delegacoes: boolean;
  /** O seletor de motor no composer. */
  seletorDeMotor: boolean;
  /** A bolha de `/comandos` do campo. */
  bolhaDeComandos: boolean;
  /** A pesquisa do canário na gaveta. */
  pesquisa: boolean;
  /** O `/encerrar` dos comandos da gaveta (o `/compact` fica). */
  encerrar: boolean;
  /** O bloco "Motor" da gaveta (a cota fica). */
  blocoDeMotor: boolean;
  /** A troca da conta da máquina, no chip da cota (`/api/contas`). */
  trocaDeConta: boolean;
  /** A porta dos MCPs na gaveta. */
  mcps: boolean;
  /** Entrar/Sair: login do portão e o Sair da gaveta. */
  sessaoDoPortao: boolean;
};

export function pecasDo(modo: ModoDoCockpit): Pecas {
  const frota = modo === 'frota';
  return {
    tropa: frota,
    faxina: frota,
    delegacoes: frota,
    seletorDeMotor: frota,
    bolhaDeComandos: frota,
    pesquisa: frota,
    encerrar: frota,
    blocoDeMotor: frota,
    trocaDeConta: frota,
    mcps: frota,
    sessaoDoPortao: !frota,
  };
}

export const PECAS: Pecas = pecasDo(MODO);

/** Os nomes que o navegador mostra (aba, tela inicial, manifest). A frota
 *  segue com os de sempre; o cliente não vê a marca da casa. */
export type NomesDoProduto = {
  titulo: string;
  nome: string;
  nomeCurto: string;
  descricao: string;
  /** Como a tela chama quem usa ("Boa noite, Rica"). O cliente não tem nome
   *  cadastrado no portão: a frase sai sem vocativo. */
  vocativo: string | null;
};

export function nomesDo(modo: ModoDoCockpit): NomesDoProduto {
  return modo === 'frota'
    ? {
        titulo: 'Cockpit — Grupo Borges',
        nome: 'Grupo Borges — Cockpit',
        nomeCurto: 'Cockpit',
        descricao: 'Painel da frota. Log de execução que às vezes conversa.',
        vocativo: 'Rica',
      }
    : {
        titulo: 'Painel do agente',
        nome: 'Painel do agente',
        nomeCurto: 'Agente',
        descricao: 'Converse com o seu agente e acompanhe o trabalho dele.',
        vocativo: null,
      };
}

export const NOMES: NomesDoProduto = nomesDo(MODO);
