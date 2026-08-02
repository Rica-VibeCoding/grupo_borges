/**
 * A APARÊNCIA das seis fases do envio (contrato de dados §3.1).
 *
 * ⚠️ Isto NÃO é `lib/envio.ts`. Aquele é o motor — o redutor que decide QUANDO
 * uma fase vira outra (200 do POST → `aceito`, eco no stream → `confirmado`,
 * prazo estourado → `nao-confirmado`) e ele é da Tara. Este módulo responde a outra
 * pergunta: dada uma fase, o que a tela mostra. Os nomes das fases são
 * idênticos aos do contrato de propósito — quando o motor dela entrar, o
 * encaixe é direto e não há tabela de tradução no meio para envelhecer.
 *
 * ── O problema que este arquivo resolve ──────────────────────────────────
 *
 * O defeito diagnosticado hoje é o painel cantar "enviado" pela COLAGEM: o
 * `tmux_delivered=True` de `agents.py:1973` é literal e sai 150ms antes do
 * Enter, que ninguém verifica. Consequência: `aceito` e `confirmado` são coisas
 * completamente diferentes que hoje têm a mesma aparência — nenhuma.
 *
 * Distingui-las por PALAVRA não resolve: no celular, de relance, no sol,
 * ninguém lê. Então a distinção é por MOVIMENTO, que é o sinal que o olho pega
 * sem foco:
 *
 *   enviando/aceito → um fio percorre a base da mensagem. A máquina ainda está
 *                     observando. Nada acabou.
 *   confirmado      → o fio some, o texto acende de `secondary` para `primary`,
 *                     e a superfície ganha o fio de luz (`.ck-lit`).
 *   nao-confirmado  → o fio PARA no meio do caminho e não completa. A máquina
 *                     não observou o desfecho e não inventa qual foi.
 *
 * São quatro sinais simultâneos entre `aceito` e `confirmado` — movimento,
 * luminância do texto, fio de luz e filete —, e o único que exige leitura é a
 * palavra, que vem por cima e não no lugar deles.
 *
 * ── Por que `confirmado` não diz nada ────────────────────────────────────
 *
 * Sucesso é silêncio. É a mesma regra da linha de ferramenta (§7, `117749e`):
 * lá, 738 vistos verdes matariam o sinal de uma falha. Aqui, um "entregue!" a
 * cada mensagem treina o olho a ignorar a área — e é exatamente essa área que
 * precisa gritar quando algo ficar sem confirmação.
 *
 * Módulo neutro: sem `'use client'`.
 */

/** Nomes idênticos aos da §3.1 do contrato de dados. Não renomear. */
export type FaseEnvio =
  | 'ocioso'
  | 'enviando'
  | 'aceito'
  | 'confirmado'
  | 'nao-confirmado'
  | 'falhou';

export type AcaoEnvio = 'reenviar' | 'copiar' | 'tentar-de-novo';

export type AparenciaEnvio = {
  /** Cor do filete de 2px à esquerda. `null` = sem filete (só o confirmado). */
  filete: string | null;
  /** A mensagem já é definitiva? Governa o fio de luz e o peso do texto. */
  assentada: boolean;
  /** O fio da base: percorrendo, parado no meio, ou ausente. */
  fio: 'correndo' | 'travado' | 'nenhum';
  /** Frase do estado. `null` no caminho feliz — sucesso é silêncio. */
  frase: string | null;
  /** O que a pessoa pode fazer daqui. Vazio quando não há nada a decidir. */
  acoes: AcaoEnvio[];
  /** Texto do leitor de tela. A frase visível é curta; esta é completa. */
  anuncio: string;
  /** `polite` não interrompe leitura; `assertive` interrompe. Só o que exige
   *  decisão humana tem direito de interromper. */
  urgencia: 'polite' | 'assertive';
};

/**
 * A frase de `nao-confirmado` é a mais importante da tela e por isso está escrita
 * aqui e não em JSX: ela é a única coisa que separa um diagnóstico útil de um
 * erro genérico. Diz (1) o que se sabe, (2) o que provavelmente aconteceu e
 * (3) qual é o custo de agir — nesta ordem, porque é a ordem em que a pessoa
 * decide. "Mandar de novo pode duplicar" é a informação que impede o dano.
 */
export function aparenciaDe(fase: FaseEnvio, nomeDoAgente: string): AparenciaEnvio {
  switch (fase) {
    case 'ocioso':
      return {
        filete: null,
        assentada: true,
        fio: 'nenhum',
        frase: null,
        acoes: [],
        anuncio: '',
        urgencia: 'polite',
      };

    case 'enviando':
      return {
        filete: 'var(--ck-state-running)',
        assentada: false,
        fio: 'correndo',
        // Sem frase: o POST costuma durar menos que o tempo de ler uma palavra,
        // e texto que pisca por 200ms é ruído, não informação.
        frase: null,
        acoes: [],
        anuncio: 'Enviando.',
        urgencia: 'polite',
      };

    case 'aceito':
      return {
        filete: 'var(--ck-state-running)',
        assentada: false,
        fio: 'correndo',
        frase: `esperando ${nomeDoAgente} ver`,
        acoes: [],
        anuncio: `O texto chegou ao terminal. Esperando ${nomeDoAgente} ver.`,
        urgencia: 'polite',
      };

    case 'confirmado':
      return {
        filete: null,
        assentada: true,
        fio: 'nenhum',
        frase: null,
        acoes: [],
        anuncio: `${nomeDoAgente} recebeu.`,
        urgencia: 'polite',
      };

    case 'nao-confirmado':
      return {
        // Âmbar é o token de ESPERA HUMANO, e é literalmente o que isto é: a
        // máquina não tem o que fazer sozinha, a decisão de reenviar é do Rica.
        filete: 'var(--ck-state-attention)',
        assentada: false,
        fio: 'travado',
        frase: 'não consegui confirmar se entrou — confira no chat antes de mandar de novo. Pode duplicar.',
        acoes: ['reenviar', 'copiar'],
        anuncio: `Envio não confirmado. Confira no chat de ${nomeDoAgente} antes de mandar de novo, pois a mensagem pode duplicar.`,
        urgencia: 'assertive',
      };

    case 'falhou':
      return {
        filete: 'var(--ck-state-fail)',
        // Perder o fio de luz é a metáfora do sistema inteiro: luz é vida, e
        // esta mensagem não vive em lugar nenhum. Idêntico à §7.
        assentada: false,
        fio: 'nenhum',
        frase: 'não saiu',
        acoes: ['tentar-de-novo'],
        anuncio: 'O envio falhou. A mensagem não saiu daqui.',
        urgencia: 'assertive',
      };
  }
}

const ROTULO_ACAO: Record<AcaoEnvio, string> = {
  // Voz ativa e o mesmo verbo do começo ao fim: o botão diz o que acontece.
  reenviar: 'Mandar de novo',
  copiar: 'Copiar texto',
  'tentar-de-novo': 'Tentar de novo',
};

export function rotulaAcao(acao: AcaoEnvio): string {
  return ROTULO_ACAO[acao];
}

/** A fase ainda vai mudar sozinha? Governa quem fica montado observando o
 *  stream — e, no futuro, quem o motor da Tara ainda está cronometrando. */
export function emTransito(fase: FaseEnvio): boolean {
  return fase === 'enviando' || fase === 'aceito';
}
