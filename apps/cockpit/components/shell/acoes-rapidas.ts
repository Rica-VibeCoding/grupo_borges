/**
 * As ações rápidas do painel — a régua, sem React, sem DOM, sem rede.
 *
 * O §17 do contrato de estética deixou esta metade em aberto e chamou pelo
 * nome: o Rica trata as ações como *"ideia central do painel"*. O back já
 * expõe as rotas (`patchAgentPermissionMode`, `postAgentDestrava`,
 * `patchAgentCodexSandbox`, `postAgentRelaunch`); o que faltava era a camada
 * de cliente — estado, tradução e falha.
 *
 * TRÊS COISAS QUE ESTE MÓDULO DECIDE, e nenhuma cabe em JSX:
 *
 * 1. **É UM controle por agente, e eles nunca aparecem juntos.** `sandbox` só
 *    existe em agente Codex (o back responde 400 `not_a_codex_agent` fora
 *    disso) e `permission-mode` escreve o settings do Claude Code, que não
 *    governa a Tara. Oferecer um controle que o back vai recusar com 400 é o
 *    botão morto da §9 com outra roupa.
 *
 *    **O esforço saiu daqui em 09/08**, por ordem do Rica: *"já temos ele no
 *    input"*. Ele vive no composer (`seletor-motor.tsx`, que continua chamando
 *    `patchAgentEffort`) e ter o mesmo seletor duas vezes na mesma tela é
 *    duplicata, não redundância útil — a gaveta perdeu o bloco inteiro, não só
 *    o desenho apertado que ela tinha com seis níveis.
 *
 * 2. **A ordem dos segmentos é a escada de risco, sempre crescente da esquerda
 *    para a direita** — nunca a ordem em que o back listou o `allowed`. Ler
 *    `Só planeja · Pergunta · Livre` ensina a escala de uma vez; ler a mesma
 *    lista embaralhada obriga a decorar posição. Vale igual para sandbox
 *    (leitura→total). Valor desconhecido vai para o fim, na ordem em que veio:
 *    o back pode ganhar um degrau novo antes desta tabela, e sumir com ele
 *    seria pior do que mostrá-lo fora de escala.
 *
 * 3. ~~**A ressalva do back é texto na tela, não `title`.**~~ **REVOGADO pelo
 *    Rica em 30/07**, olhando o painel plugado: *"pode retirar os textos
 *    explicativos"*, citando esta frase pelo nome. A ressalva de
 *    `session_may_diverge` saiu da tela e as duas funções que a distribuíam
 *    (`ressalvaComum`, `ressalvaDoControle`) saíram junto — código sem
 *    consumidor é código morto.
 *
 *    O que NÃO saiu: o campo `ressalva` do `Controle` e o `descreveControle`,
 *    que continua dizendo a ressalva por extenso no `aria-label` do grupo. Ele
 *    mandou tirar o texto explicativo da tela, não desligar o leitor de tela —
 *    e nada foi inventado no lugar do vazio.
 *
 */
import type {
  AgentPainelResponse,
  PainelCodexSandbox,
  PainelPermissionMode,
} from '@grupo_borges/cockpit-core/cockpit-types';

export type AcaoId = 'permissao' | 'sandbox';

export type Opcao = {
  /** O que vai cru pro back — é o contrato do endpoint. */
  valor: string;
  /** O que o Rica lê. Português, sempre (R.1). */
  rotulo: string;
  /** O que o valor faz, por extenso. Vira `title` sozinha e entra no
   *  `aria-label` somada ao `rotulo` (o rótulo sozinho já é o nome acessível
   *  mínimo — a descrição completa, nunca substitui): no toque o `title` não
   *  existe, então o `aria-label` é quem carrega a explicação. */
  descricao: string;
};

export type Controle = {
  id: AcaoId;
  /** Overline do bloco. */
  titulo: string;
  opcoes: Opcao[];
  /** `null` quando o back não sabe — o segmentado nasce sem nenhum ativo, que
   *  é a verdade, em vez de acender um palpite. */
  valor: string | null;
  /** Frase da ressalva, ou `null` quando o back garantiu o valor. */
  ressalva: string | null;
};

const RESSALVA =
  'Lido da configuração — a sessão em execução pode estar em outro valor.';

// ---------------------------------------------------------------------------
// Tradução
// ---------------------------------------------------------------------------

const PERMISSAO: Record<PainelPermissionMode, { rotulo: string; descricao: string }> = {
  plan: { rotulo: 'Só planeja', descricao: 'Lê e propõe. Não altera nada.' },
  ask: { rotulo: 'Pergunta', descricao: 'Pede confirmação antes de cada ação.' },
  acceptEdits: {
    rotulo: 'Aceita edições',
    descricao: 'Grava arquivo sem perguntar; o resto continua perguntando.',
  },
  bypassPermissions: {
    rotulo: 'Livre',
    descricao: 'Executa tudo sem pedir confirmação.',
  },
};

/** A escada de risco da permissão. É esta a ordem na tela. */
const ORDEM_PERMISSAO: PainelPermissionMode[] = ['plan', 'ask', 'acceptEdits', 'bypassPermissions'];

/** Os três que o painel oferece sempre. `acceptEdits` existe no tipo e o back
 *  aceita, mas nem o cockpit antigo o oferecia — ele entra só quando é o valor
 *  ATUAL, porque esconder o modo em que o agente está seria mentir sobre o
 *  estado. Oferecer um quarto degrau que ninguém pediu é o outro erro. */
const PERMISSAO_PADRAO: PainelPermissionMode[] = ['plan', 'ask', 'bypassPermissions'];

const SANDBOX: Record<PainelCodexSandbox, { rotulo: string; descricao: string }> = {
  'read-only': { rotulo: 'Leitura', descricao: 'Só lê. Não escreve nada.' },
  'workspace-write': {
    rotulo: 'Workspace',
    descricao: 'Escreve dentro do repositório, não fora dele.',
  },
  'danger-full-access': {
    rotulo: 'Total',
    descricao: 'Escreve em qualquer lugar da máquina.',
  },
};

const ORDEM_SANDBOX: PainelCodexSandbox[] = ['read-only', 'workspace-write', 'danger-full-access'];

export function rotulaPermissao(modo: string): string {
  return PERMISSAO[modo as PainelPermissionMode]?.rotulo ?? modo;
}

export function rotulaSandbox(valor: string): string {
  return SANDBOX[valor as PainelCodexSandbox]?.rotulo ?? valor;
}

/** Ordena pela escada canônica; o que não está nela vai pro fim, preservando a
 *  ordem de chegada. Estável de propósito — dois degraus novos do back não
 *  podem trocar de lugar entre um render e outro. */
function pelaEscada(valores: string[], escada: string[]): string[] {
  const conhecidos = escada.filter((v) => valores.includes(v));
  const resto = valores.filter((v) => !escada.includes(v));
  return [...conhecidos, ...resto];
}

// ---------------------------------------------------------------------------
// Montagem
// ---------------------------------------------------------------------------

/** Codex se reconhece pelo `sandbox` no payload — o back só o inclui quando
 *  `executor_kind='codex'`. `codex_native` diz a mesma coisa e é opcional;
 *  usar os dois é cinto e suspensório barato, e o payload real já veio com um
 *  deles ausente em agente antigo. */
export function ehCodex(painel: AgentPainelResponse): boolean {
  return Boolean(painel.codex_native) || painel.sandbox != null;
}

export function montaControles(painel: AgentPainelResponse): Controle[] {
  const controles: Controle[] = [];

  if (ehCodex(painel)) {
    // Sandbox no lugar de permissão: é a troca que o `cockpit-types.ts` já
    // descreve ("FUNÇÕES vira sandbox"), e não é cosmética — o endpoint de
    // permissão escreve o settings do Claude Code, que não governa a Tara.
    const sandbox = painel.sandbox;
    if (sandbox) {
      const valores = pelaEscada(sandbox.allowed ?? [], ORDEM_SANDBOX);
      if (valores.length > 0) {
        controles.push({
          id: 'sandbox',
          titulo: 'Sandbox',
          valor: sandbox.value ?? null,
          ressalva: sandbox.session_may_diverge ? RESSALVA : null,
          opcoes: valores.map((valor) => ({
            valor,
            rotulo: rotulaSandbox(valor),
            descricao: SANDBOX[valor as PainelCodexSandbox]?.descricao ?? valor,
          })),
        });
      }
    }
    return controles;
  }

  const modoAtual = painel.permission?.mode ?? null;
  const modos = [...PERMISSAO_PADRAO];
  // O modo em que o agente ESTÁ sempre aparece, mesmo fora dos três padrão.
  if (modoAtual && !modos.includes(modoAtual)) modos.push(modoAtual);

  controles.push({
    id: 'permissao',
    titulo: 'Permissões',
    valor: modoAtual,
    ressalva: painel.permission?.session_may_diverge ? RESSALVA : null,
    opcoes: pelaEscada(modos, ORDEM_PERMISSAO).map((valor) => ({
      valor,
      rotulo: rotulaPermissao(valor),
      descricao: PERMISSAO[valor as PainelPermissionMode]?.descricao ?? valor,
    })),
  });

  return controles;
}

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
// Relançar
// ---------------------------------------------------------------------------

/**
 * As duas ações BRUTAS do painel — as que armam e pedem confirmação.
 *
 * - `resume` mata o processo do Claude Code no pane e sobe outro com
 *   `--resume <session_id>`: a conversa sobrevive, só o turno em andamento
 *   morre.
 * - `desligar` encerra o agente e tudo que ele consome — o processo, os MCPs e
 *   o `bun` do plugin de canal, parando o cgroup inteiro da cerca da frota.
 *
 * Nenhuma das duas é toque simples como o destrava. O destrava manda Escape,
 * idempotente — errar o toque não custa nada. Aqui errar custa caro nas duas
 * (o resume perde o turno em voo, o desligar tira o agente do ar). O gesto é o
 * mesmo já usado no destrava-durante-compact (armar e confirmar), e não a
 * pressão longa do cockpit antigo: pressão longa esconde a ação de quem está
 * com pressa, e estes botões existem justamente para a hora em que o agente
 * deu problema e o Rica precisa agir.
 *
 * **O `fresco` saiu em 10/08 junto com o Restart** — ordem do Rica: *"Restart
 * sai, destravar fica"*. O boot sem contexto era o degrau mais caro e o menos
 * usado; quem precisa recomeçar do zero usa `/clear` dentro do agente. O
 * Desligar ocupa o lugar exato que era dele na linha.
 *
 * As duas compartilham o MESMO estado no componente (`useAcaoBruta` em
 * `bloco-de-acoes.tsx`), não duas instâncias — só uma pode sair de `ocioso` por
 * vez, o que evita o dedo disparar duas ações brutas ao mesmo tempo.
 */
export type AcaoBruta = 'resume' | 'desligar';

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

/** Rótulo SEMPRE curto — os três botões (Destravar/Resume/Desligar) dividem
 *  ~110px na gaveta de 380px (§ auditoria 03/08: a frase longa de confirmação
 *  cortava em elipse, e `text-overflow` nem se aplica dentro de um flex —
 *  cortava sem reticências, sumindo com "tocar de novo confirma", que é
 *  justamente o aviso que evita o toque acidental). A frase completa mora só
 *  em `descreveAcaoBruta` (aria-label + aviso visível de largura cheia,
 *  renderizado fora do botão). */
export function rotulaAcaoBruta(fase: FaseBruta, acao: AcaoBruta = 'resume'): string {
  if (fase === 'confirmando') return 'Confirmar?';
  if (acao === 'desligar') {
    if (fase === 'enviando') return 'Desligando…';
    return fase === 'concluido' ? 'Desligado' : 'Desligar';
  }
  if (fase === 'enviando') return 'Relançando…';
  return fase === 'concluido' ? 'Relançado' : 'Resume';
}

/** A frase completa — SEMPRE, em toda fase (não só o ocioso). Serve dois
 *  papéis: nome acessível (WCAG 2.5.3, começa pelo rótulo curto do botão) e,
 *  quando `fase === 'confirmando'`, o texto do aviso visível de largura cheia
 *  que substitui o que cortava dentro do botão. */
export function descreveAcaoBruta(fase: FaseBruta, acao: AcaoBruta = 'resume'): string {
  const rotulo = rotulaAcaoBruta(fase, acao);
  if (fase === 'enviando' || fase === 'concluido') return rotulo;
  if (fase === 'confirmando') {
    return acao === 'desligar'
      ? `${rotulo} Tira o agente do ar — tocar de novo confirma`
      : `${rotulo} Mata o turno atual — tocar de novo confirma`;
  }
  return acao === 'desligar'
    ? `${rotulo}: encerra o agente e tudo que ele consome — o processo, os MCPs e o canal. A conversa fica, e Ligar retoma de onde parou`
    : `${rotulo}: relança o Claude Code do agente retomando a conversa atual — o turno em andamento é perdido`;
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

/** Mesma régua do `leiaRelancar`: 200 não é sucesso. O `confirmed` do back é o
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
 *  `diagnosticaRelancar`: substring do detail preservado pelo cliente. */
export function diagnosticaCicloDeVida(erro: unknown, acao: 'desligar' | 'ligar'): Impedimento {
  const texto = textoDoErro(erro);

  if (texto.includes('ciclo_de_vida_somente_claude_code')) {
    return {
      resumo: 'este agente não tem sessão própria pra ligar ou desligar',
      saida: 'a Tara é Codex — ela nasce e morre a cada turno, não fica de pé',
    };
  }
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

/**
 * Mesma régua do `leiaDestrava`: 200 não é sucesso. O back devolve `attempted`
 * (mandou o comando) separado de `tmux_delivered` (viu o CC voltar de pé) —
 * dizer "relançado" com o segundo falso seria prometer um agente vivo que
 * pode ter ficado num pane morto, que é o pior lugar para mentir: o Rica só
 * descobriria ao mandar a próxima mensagem e não receber nada.
 */
export function leiaRelancar(resposta: {
  tmux_delivered: boolean;
  attempted: boolean;
}): Impedimento | null {
  if (resposta.tmux_delivered) return null;
  return resposta.attempted
    ? {
        resumo: 'mandei relançar mas o Claude Code não voltou de pé',
        saida: 'abra o terminal do agente e veja o que ficou na tela antes de tentar de novo',
      }
    : {
        resumo: 'o relançamento nem chegou a ser tentado',
        saida: 'a sessão do agente pode estar fechada — confira se ela está viva',
      };
}

/** Traduz as recusas do `POST /{slug}/relaunch`. Casa por substring do detail
 *  preservado pelo `postAgentRelaunch`. */
export function diagnosticaRelancar(erro: unknown): Impedimento {
  const texto = textoDoErro(erro);

  if (texto.includes('relaunch_somente_claude_code')) {
    return {
      resumo: 'este agente não roda Claude Code',
      saida: 'a Tara é Codex — relançar preservando conversa só existe no Claude Code',
    };
  }
  if (texto.includes('resume_session_not_found')) {
    return {
      resumo: 'não achei a conversa para retomar',
      saida: 'relançar agora começaria do zero, então não relancei — fale com o agente uma vez e tente de novo',
    };
  }
  if (texto.includes('relaunch_failed')) {
    return {
      resumo: 'o tmux recusou o relançamento',
      saida: 'a sessão pode ter sido fechada por fora — confira se ela está viva',
    };
  }
  if (texto.includes('confirmacao_explicita_obrigatoria')) {
    return {
      resumo: 'o servidor não recebeu a confirmação',
      saida: 'isso é defeito nosso, não seu — avise o Daniel',
    };
  }
  if (texto.includes('404')) {
    return {
      resumo: 'o agente sumiu da frota',
      saida: 'volte para a lista e abra de novo',
    };
  }
  return {
    resumo: 'não consegui relançar o agente',
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

const NOME_DA_ACAO: Record<AcaoId, string> = {
  permissao: 'a permissão',
  sandbox: 'o sandbox',
};

/**
 * Traduz a falha das rotas. As mensagens do back chegam cruas no `Error`
 * (`errorDetail` do `api.ts` já extrai o `detail` do FastAPI), então casar por
 * substring é o que dá — e é frágil de propósito: rótulo novo cai no caso
 * geral, que continua acionável.
 */
/** O texto pesquisável de qualquer coisa que caia num `catch`. Extraído de
 *  `diagnosticaAcao` quando o relançar precisou da mesma leitura — dois
 *  diagnósticos casando substring sobre formas diferentes de erro dariam dois
 *  jeitos sutilmente diferentes de errar. */
function textoDoErro(erro: unknown): string {
  if (typeof erro === 'string') return erro;
  if (erro instanceof Error) return erro.message;
  if (typeof erro === 'object' && erro !== null && 'message' in erro) {
    return String((erro as { message: unknown }).message);
  }
  return '';
}

export function diagnosticaAcao(erro: unknown, id: AcaoId): Impedimento {
  const texto = textoDoErro(erro);
  const alvo = NOME_DA_ACAO[id];

  if (texto.includes('not_a_codex_agent')) {
    return {
      resumo: 'este agente não é Codex',
      saida: 'sandbox só existe na Tara — recarregue o painel para ver os controles certos',
    };
  }
  // O ramo `not_allowed` saiu com o esforço (09/08). Ele traduzia
  // `codex_effort_not_allowed`/`kimi_effort_not_allowed`, e esses são os DOIS
  // únicos `not_allowed` que o back devolve para as rotas deste bloco
  // (`agents.py:476` e `:491`, conferido) — sem o segmentado de esforço aqui,
  // nenhuma chamada daqui consegue mais provocá-lo. Quem recusa nível hoje é o
  // composer, que tem tradução própria em `motor.ts`.
  if (texto.includes('404')) {
    return {
      resumo: 'o agente sumiu da frota',
      saida: 'volte para a lista e abra de novo',
    };
  }
  if (texto.includes('500') || texto.includes('503')) {
    return {
      resumo: `o servidor falhou ao gravar ${alvo}`,
      saida: 'tente de novo; se repetir, é infra — avise o Pavan',
    };
  }
  return {
    resumo: `não consegui trocar ${alvo}`,
    saida: 'o valor voltou ao que era — tente de novo',
  };
}

/** O que o leitor de tela anuncia no segmentado inteiro. A ressalva entra por
 *  extenso: o resumo visual não tem espaço para ela, e ela não pode sumir. */
export function descreveControle(controle: Controle): string {
  const atual = controle.valor
    ? controle.opcoes.find((o) => o.valor === controle.valor)?.rotulo ?? controle.valor
    : 'sem valor';
  const base = `${controle.titulo}: ${atual}`;
  return controle.ressalva ? `${base}. ${controle.ressalva}` : base;
}
