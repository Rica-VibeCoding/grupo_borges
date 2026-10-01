/**
 * As ações rápidas do painel — a régua, sem React, sem DOM, sem rede.
 *
 * O contrato de estética (hoje no histórico) deixou esta metade em aberto e chamou pelo
 * nome: o Rica trata as ações como *"ideia central do painel"*. O back já
 * expõe as rotas (`postAgentDestrava`, `postAgentDesligar`,
 * `postAgentLigar`); o que faltava era a camada de cliente — estado,
 * tradução e falha.
 *
 * DUAS COISAS QUE ESTE MÓDULO DECIDE, e nenhuma cabe em JSX:
 *
 * 1. **O esforço saiu daqui em 09/08**, por ordem do Rica: *"já temos ele no
 *    input"*. Ele vive no composer (`seletor-motor.tsx`, que continua chamando
 *    `patchAgentEffort`) e ter o mesmo seletor duas vezes na mesma tela é
 *    duplicata, não redundância útil — a gaveta perdeu o bloco inteiro, não só
 *    o desenho apertado que ela tinha com seis níveis.
 *
 * 2. **A permissão saiu em 28/09**, com o segmentado inteiro e o Resume: a
 *    frota roda sempre liberada e o Rica nunca trocava. Saíram junto a
 *    tradução, a escada de risco e o diagnóstico que só ela usava.
 *
 */

// ---------------------------------------------------------------------------
// Destrava
// ---------------------------------------------------------------------------

export type FaseDestrava = 'ocioso' | 'enviando' | 'entregue';

/** Quanto tempo a confirmação fica na tela antes de o botão voltar ao normal.
 *  Curto de propósito: é recibo, não estado — o painel não pode ficar com um
 *  "pronto" fóssil enquanto o Rica olha outra coisa. */
export const RECIBO_MS = 1600;

export function rotulaDestrava(fase: FaseDestrava): string {
  if (fase === 'enviando') return 'Destravando…';
  if (fase === 'entregue') return 'Enviado';
  return 'Destravar';
}

/**
 * O 200 do destrava NÃO é sucesso — `tmux_delivered` pode voltar `false`, e é
 * exatamente o mesmo literal mentiroso que a máquina de envio existe pra não
 * repetir (§3.1 do contrato de dados). Sem esta conferência, um agente com o
 * pane morto responderia "Escape enviado" para uma tecla que nunca chegou.
 */
export function leiaDestrava(resposta: { tmux_delivered: boolean }): Impedimento | null {
  return resposta.tmux_delivered
    ? null
    : {
        resumo: 'o Escape não chegou ao tmux do agente',
        saida: 'a sessão pode estar fechada — confira no cockpit se ela está viva',
      };
}

// ---------------------------------------------------------------------------
// Desligar
// ---------------------------------------------------------------------------

/**
 * A ação BRUTA do painel — a que arma e pede confirmação. `desligar` encerra o
 * agente e tudo que ele consome — o processo, os MCPs e o `bun` do plugin de
 * canal, parando o cgroup inteiro da cerca da frota.
 *
 * O `resume` saiu em 28/09, por ordem do Rica: ele nunca usava.
 *
 * Não é toque simples como o destrava. O destrava manda Escape, idempotente —
 * errar o toque não custa nada. Aqui errar tira o agente do ar. O gesto é o
 * mesmo já usado no destrava-durante-compact (armar e confirmar), e não a
 * pressão longa do cockpit antigo: pressão longa esconde a ação de quem está
 * com pressa, e estes botões existem justamente para a hora em que o agente
 * deu problema e o Rica precisa agir.
 *
 * **O `fresco` saiu em 10/08 junto com o Restart** — ordem do Rica: *"Restart
 * sai, destravar fica"*. O boot sem contexto era o degrau mais caro e o menos
 * usado; quem precisa recomeçar do zero usa `/clear` dentro do agente. O
 * Desligar ocupa o lugar exato que era dele na linha.
 */
export type AcaoBruta = 'desligar';

export type FaseBruta = 'ocioso' | 'confirmando' | 'enviando' | 'concluido';

/** Quanto tempo a confirmação fica armada. Mais longa que a do
 *  destrava-durante-compact (4s): ali o segundo toque é reflexo de quem já
 *  decidiu, aqui a frase avisa o que se perde e merece ser lida. */
export const CONFIRMA_ACAO_MS = 6_000;

/** Espera da primeira retentativa do `/painel` depois de ele ter caído, e teto
 *  do crescimento. Painel fora do ar não pode virar estado permanente: um
 *  restart da API de 6 segundos apagava os controles da tela até o Rica fechar
 *  e reabrir a gaveta, e o que ele via era o botão sumindo sozinho e não
 *  voltando mais. Começa curto porque a causa comum é justamente um restart —
 *  e cresce até 15s para não martelar uma API que está de fato fora. */
export const RETENTA_PAINEL_BASE_MS = 2_000;
export const RETENTA_PAINEL_TETO_MS = 15_000;

/** Quando reler o painel DEPOIS do Ligar. O `POST /ligar` responde em ~1s, mas
 *  ele só entregou o comando ao tmux: o boot leva 13 a 15 segundos (medido
 *  09/09 — Ligar às 20:39:49, agente de pé às 20:40:02). Uma leitura única cai
 *  no meio da subida, lê a ressalva de "vale no próximo boot" ainda verdadeira
 *  e para de olhar — era ISSO que obrigava o Rica ao F5. Cinco leituras cobrem
 *  o boot com folga e param sozinhas; não é polling, tem fim. */
export const ESPERAS_APOS_LIGAR_MS = [3_000, 7_000, 12_000, 18_000, 25_000] as const;

/** Rótulo SEMPRE curto — nasceu com três botões dividindo
 *  ~110px na gaveta de 380px (§ auditoria 03/08: a frase longa de confirmação
 *  cortava em elipse, e `text-overflow` nem se aplica dentro de um flex —
 *  cortava sem reticências, sumindo com "tocar de novo confirma", que é
 *  justamente o aviso que evita o toque acidental). A frase completa mora só
 *  em `descreveAcaoBruta` (aria-label + aviso visível de largura cheia,
 *  renderizado fora do botão). */
export function rotulaAcaoBruta(fase: FaseBruta): string {
  if (fase === 'confirmando') return 'Confirmar?';
  if (fase === 'enviando') return 'Desligando…';
  return fase === 'concluido' ? 'Desligado' : 'Desligar';
}

/** A frase completa — SEMPRE, em toda fase (não só o ocioso). Serve dois
 *  papéis: nome acessível (WCAG 2.5.3, começa pelo rótulo curto do botão) e,
 *  quando `fase === 'confirmando'`, o texto do aviso visível de largura cheia
 *  que substitui o que cortava dentro do botão. */
export function descreveAcaoBruta(fase: FaseBruta): string {
  const rotulo = rotulaAcaoBruta(fase);
  if (fase === 'enviando' || fase === 'concluido') return rotulo;
  if (fase === 'confirmando') return `${rotulo} Tira o agente do ar — tocar de novo confirma`;
  return `${rotulo}: encerra o agente e tudo que ele consome — o processo, os MCPs e o canal. A conversa fica, e Ligar retoma de onde parou`;
}

// ---------------------------------------------------------------------------
// Ligar
// ---------------------------------------------------------------------------

/** Ligar reaproveita o ciclo do destrava (`ocioso → enviando → entregue`), não
 *  o das ações brutas: subir um agente que estava fora do ar não destrói nada,
 *  então pedir confirmação seria copiar a proteção sem o perigo — o mesmo erro
 *  que a pressão longa do cockpit antigo cometia com o destrava. */
export function rotulaLigar(fase: FaseDestrava): string {
  if (fase === 'enviando') return 'Ligando…';
  if (fase === 'entregue') return 'Ligado';
  return 'Ligar';
}

export function descreveLigar(fase: FaseDestrava): string {
  const rotulo = rotulaLigar(fase);
  return fase === 'ocioso'
    ? `${rotulo}: sobe o agente de volta retomando a conversa de onde ela parou`
    : rotulo;
}

/** Mesma régua do `leiaDestrava`: 200 não é sucesso. O `confirmed` do back é o
 *  processo do CLI visto de pé no pane, não "mandei o comando" — e o boot segue
 *  em curso mesmo quando ele volta falso, daí a saída não mandar tentar de novo
 *  na hora. */
export function leiaLigar(resposta: {
  tmux_delivered: boolean;
  attempted: boolean;
}): Impedimento | null {
  if (resposta.tmux_delivered) return null;
  return {
    resumo: 'mandei ligar mas o agente ainda não apareceu de pé',
    saida: 'o boot pode estar em curso — espere alguns segundos e recarregue o painel',
  };
}

/** O desligar é idempotente: agente que já estava fora do ar é sucesso, não
 *  falha. O único desfecho que merece aviso é um cgroup que resistiu ao `stop`,
 *  porque aí sobrou processo consumindo CPU — que é exatamente o que este botão
 *  existe pra não deixar para trás. */
export function leiaDesligar(resposta: {
  tmux_delivered: boolean;
  scopes_resistiram?: string[];
}): Impedimento | null {
  if (resposta.tmux_delivered) return null;
  const quantos = resposta.scopes_resistiram?.length ?? 0;
  return {
    resumo:
      quantos > 1
        ? `${quantos} processos do agente resistiram ao desligamento`
        : 'um processo do agente resistiu ao desligamento',
    saida: 'a sessão foi encerrada, mas sobrou coisa consumindo CPU — avise o Pavan',
  };
}

/** Traduz as recusas de `POST /{slug}/desligar` e `/ligar`. Mesma técnica do
 *  que já traduzia o relançar (saiu em 28/09): substring do detail preservado pelo cliente. */
export function diagnosticaCicloDeVida(erro: unknown, acao: 'desligar' | 'ligar'): Impedimento {
  const texto = textoDoErro(erro);

  if (texto.includes('ligar_em_curso')) {
    return {
      resumo: 'já tem um boot deste agente em andamento',
      saida: 'espere ele terminar — ligar duas vezes subiria duas sessões',
    };
  }
  if (texto.includes('404')) {
    return {
      resumo: 'o agente sumiu da frota',
      saida: 'volte para a lista e abra de novo',
    };
  }
  return acao === 'ligar'
    ? {
        resumo: 'não consegui ligar o agente',
        saida: 'o boot da frota recusou — confira o log em ~/logs/subir-frota.log',
      }
    : {
        resumo: 'não consegui desligar o agente',
        saida: 'nada foi alterado — tente de novo; se repetir, é infra',
      };
}

// ---------------------------------------------------------------------------
// Falha
// ---------------------------------------------------------------------------

/** Mesmo formato do `voz.ts`, e pelo mesmo motivo: nunca só o diagnóstico,
 *  sempre a saída. Mensagem de erro sem saída é botão morto com texto. */
export type Impedimento = {
  resumo: string;
  saida: string;
};

/** O texto pesquisável de qualquer coisa que caia num `catch` — um jeito só
 *  de ler o erro, pra dois diagnósticos nunca errarem de jeitos diferentes. */
function textoDoErro(erro: unknown): string {
  if (typeof erro === 'string') return erro;
  if (erro instanceof Error) return erro.message;
  if (typeof erro === 'object' && erro !== null && 'message' in erro) {
    return String((erro as { message: unknown }).message);
  }
  return '';
}
