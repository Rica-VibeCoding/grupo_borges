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
 *   enviando/aceito → nada no composer. Ver abaixo.
 *   confirmado      → o texto acende de `secondary` para `primary` e a
 *                     superfície ganha o fio de luz (`.ck-lit`).
 *   nao-confirmado  → o fio PARA no meio do caminho e não completa. A máquina
 *                     não observou o desfecho e não inventa qual foi.
 *
 * ── O caminho feliz é MUDO no composer (Rica, 11/08) ─────────────────────
 *
 * `enviando` e `aceito` não acendem borda nem fio. O desenho anterior dava aos
 * dois o azul do estado, e ele só funcionava num CC: lá a confirmação vem do
 * eco do stream em milissegundos. Na Tara ela espera o texto aparecer no
 * rollout — medi 14 s de borda acesa (11/08), e a mesma peça que era um piscar
 * virava um holofote. Igualar por cima (todos acesos) mantinha a distorção;
 * igualar por baixo é o que deixa os seis agentes idênticos.
 *
 * O que se perde aqui não se perde na tela: a mensagem já está no feed quando o
 * composer se cala, e é lá que a espera acontece — a bolha, a linha "| Pensando".
 * O composer é o lugar de escrever, e volta a ser só isso.
 *
 * O INSUCESSO continua gritando: âmbar e vermelho mantêm filete, fio travado,
 * frase e ações. Era para isso que o vocabulário existia, e é a área que precisa
 * do olho quando algo fica sem confirmação.
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

import { anuncioPara, frasePara, type CanalBloqueado } from './canal-entrega.ts';

/** Nomes idênticos aos da §3.1 do contrato de dados. Não renomear. */
export type FaseEnvio =
  | 'ocioso'
  | 'enviando'
  | 'aceito'
  | 'confirmado'
  | 'nao-confirmado'
  | 'falhou';

export type AcaoEnvio = 'reenviar' | 'copiar' | 'tentar-de-novo' | 'destravar';

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
export function aparenciaDe(
  fase: FaseEnvio,
  nomeDoAgente: string,
  opcoes?: {
    emFila?: boolean;
    canalBloqueado?: CanalBloqueado | null;
    destravaFalhou?: boolean;
  },
): AparenciaEnvio {
  // O canal só tem direito de falar nos dois estados de insucesso. Num envio
  // que deu certo ele seria memória velha de uma tentativa anterior — o estado
  // é "desde a última recusa", não "agora", e contradizer um sucesso observado
  // com um bloqueio já superado é a mentira de UI da §9 ao contrário.
  const canal =
    fase === 'nao-confirmado' || fase === 'falhou' ? (opcoes?.canalBloqueado ?? null) : null;
  // O toque que não resolveu só significa alguma coisa ao lado do bloqueio que
  // ele tentou abrir. Sozinho é um fato sobre uma tela que já passou.
  const destravaMudo = canal !== null && opcoes?.destravaFalhou === true;
  const fraseDoCanal = destravaMudo
    ? `o destrava não resolveu — abra o terminal de ${nomeDoAgente}`
    : canal
      ? frasePara(canal)
      : null;

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
        filete: null,
        assentada: false,
        fio: 'nenhum',
        // Sem frase: o POST costuma durar menos que o tempo de ler uma palavra,
        // e texto que pisca por 200ms é ruído, não informação.
        frase: null,
        acoes: [],
        // O leitor de tela CONTINUA anunciando. Ele não tem a bolha do feed a
        // que o olho recorre, e o silêncio visual não é silêncio de fato.
        anuncio: 'Enviando.',
        urgencia: 'polite',
      };

    case 'aceito':
      return {
        filete: null,
        assentada: false,
        fio: 'nenhum',
        frase: `esperando ${nomeDoAgente} ver`,
        acoes: [],
        anuncio: `O texto chegou ao terminal. Esperando ${nomeDoAgente} ver.`,
        urgencia: 'polite',
      };

    case 'confirmado':
      // A confirmação veio da FILA, não do eco: o agente estava no meio de um
      // turno e o CLI enfileirou a mensagem (`kind: "queued"` do stream). É
      // recibo MELHOR que o eco — prova que o texto entrou na caixa de
      // entrada dele. O sucesso continua quieto nos SINAIS (sem filete, sem
      // fio, texto assentado), mas aqui a palavra vale: dizem ao Rica por que
      // a resposta não vai vir já. O eco da drenagem chega depois e só apaga
      // a marca — uma entrega, um aviso.
      if (opcoes?.emFila === true) {
        return {
          filete: null,
          assentada: true,
          fio: 'nenhum',
          frase: 'entrou na fila',
          acoes: [],
          anuncio: `${nomeDoAgente} estava ocupado. A mensagem entrou na fila e vai ser lida na sequência.`,
          urgencia: 'polite',
        };
      }
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
        // Com o canal bloqueado o "mandar de novo" SAI: o back já sabe que a
        // entrega foi recusada, então repetir o gesto não entrega — só ensina
        // que o botão não funciona. Fica o que resolve (destravar) e o que
        // resguarda (copiar).
        frase: fraseDoCanal ?? 'não consegui confirmar se entrou — confira no chat antes de mandar de novo. Pode duplicar.',
        acoes: destravaMudo ? ['copiar'] : canal ? ['destravar', 'copiar'] : ['reenviar', 'copiar'],
        anuncio: canal
          ? anuncioPara(canal, nomeDoAgente)
          : `Envio não confirmado. Confira no chat de ${nomeDoAgente} antes de mandar de novo, pois a mensagem pode duplicar.`,
        urgencia: 'assertive',
      };

    case 'falhou':
      return {
        filete: 'var(--ck-state-fail)',
        // Perder o fio de luz é a metáfora do sistema inteiro: luz é vida, e
        // esta mensagem não vive em lugar nenhum. Idêntico à §7.
        assentada: false,
        fio: 'nenhum',
        // "não saiu" é verdade, mas é só a metade que o front enxerga. O 409
        // `agent_pane_unavailable` — a recusa do driver, que é o caminho mais
        // direto do canal bloqueado — cai AQUI, e o back sabe por quê.
        //
        // Ao contrário do âmbar, o "tentar de novo" FICA: neste estado a
        // mensagem comprovadamente não saiu, então repetir não duplica. A
        // ordem é a do gesto — destravar primeiro, mandar depois.
        frase: fraseDoCanal ?? 'não saiu',
        acoes:
          destravaMudo || !canal ? ['tentar-de-novo'] : ['destravar', 'tentar-de-novo'],
        anuncio: canal
          ? anuncioPara(canal, nomeDoAgente)
          : 'O envio falhou. A mensagem não saiu daqui.',
        urgencia: 'assertive',
      };
  }
}

const ROTULO_ACAO: Record<AcaoEnvio, string> = {
  // Voz ativa e o mesmo verbo do começo ao fim: o botão diz o que acontece.
  reenviar: 'Mandar de novo',
  copiar: 'Copiar texto',
  'tentar-de-novo': 'Tentar de novo',
  // Diz em QUEM se mexe. "Destravar" sozinho, ao lado de uma mensagem que não
  // entrou, se leria como destravar a mensagem.
  destravar: 'Destravar agente',
};

export function rotulaAcao(acao: AcaoEnvio): string {
  return ROTULO_ACAO[acao];
}

/** A fase ainda vai mudar sozinha? Governa quem fica montado observando o
 *  stream — e, no futuro, quem o motor da Tara ainda está cronometrando. */
export function emTransito(fase: FaseEnvio): boolean {
  return fase === 'enviando' || fase === 'aceito';
}
