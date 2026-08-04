/**
 * As ações rápidas do painel — a régua, sem React, sem DOM, sem rede.
 *
 * O §17 do contrato de estética deixou esta metade em aberto e chamou pelo
 * nome: o Rica trata as ações como *"ideia central do painel"*. O back já
 * expõe as quatro rotas (`patchAgentEffort`, `patchAgentPermissionMode`,
 * `postAgentDestrava`, `patchAgentCodexSandbox`); o que faltava era a camada
 * de cliente — estado, tradução e falha.
 *
 * TRÊS COISAS QUE ESTE MÓDULO DECIDE, e nenhuma cabe em JSX:
 *
 * 1. **Os quatro controles NUNCA aparecem juntos.** `sandbox` só existe em
 *    agente Codex (o back responde 400 `not_a_codex_agent` fora disso) e
 *    `permission-mode` escreve o settings do Claude Code, que não governa a
 *    Tara. Na prática são TRÊS por agente: esforço + permissão + destrava no
 *    CC, esforço + sandbox + destrava no Codex. Oferecer um controle que o
 *    back vai recusar com 400 é o botão morto da §9 com outra roupa.
 *
 * 2. **A ordem dos segmentos é a escada de risco, sempre crescente da esquerda
 *    para a direita** — nunca a ordem em que o back listou o `allowed`. Ler
 *    `Só planeja · Pergunta · Livre` ensina a escala de uma vez; ler a mesma
 *    lista embaralhada obriga a decorar posição. Vale igual para esforço
 *    (baixo→máximo) e sandbox (leitura→total). Valor desconhecido vai para o
 *    fim, na ordem em que veio: o back pode ganhar um degrau novo antes desta
 *    tabela, e sumir com ele seria pior do que mostrá-lo fora de escala.
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
 * A tradução de esforço vem de `motor.ts`, importada, não copiada: duas cópias
 * da mesma tradução é como elas divergem em silêncio — a lição que o próprio
 * `motor.ts` documenta ter aprendido com `shortModelName`.
 */
import type {
  AgentPainelResponse,
  PainelCodexSandbox,
  PainelPermissionMode,
} from '@grupo_borges/cockpit-core/cockpit-types';

// Extensão explícita: o `node --test` do `package.json` roda estes módulos sem
// bundler e resolve como ESM. Mesma convenção do `gramatica.ts`.
import { rotulaEsforco } from './motor.ts';

export type AcaoId = 'esforco' | 'permissao' | 'sandbox';

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

const ORDEM_ESFORCO = ['low', 'medium', 'high', 'xhigh', 'max'];

/** Esforço não tem descrição própria por valor: `baixo`…`máximo` já é a escala
 *  inteira, e inventar prosa para cada degrau ("pensa um pouco mais") seria
 *  enfeite. A descrição diz o que o SELETOR faz. */
const DESCRICAO_ESFORCO = 'Quanto o agente raciocina antes de responder.';

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

  const esforcos = pelaEscada(painel.effort?.allowed ?? [], ORDEM_ESFORCO);
  if (esforcos.length > 0) {
    controles.push({
      id: 'esforco',
      titulo: 'Esforço',
      valor: painel.effort.value ?? null,
      ressalva: painel.effort.session_may_diverge ? RESSALVA : null,
      opcoes: esforcos.map((valor) => ({
        valor,
        rotulo: rotulaEsforco(valor) ?? valor,
        descricao: DESCRICAO_ESFORCO,
      })),
    });
  }

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
 * O relançar mata o processo do Claude Code no pane e sobe outro no lugar —
 * `resume` mata qual variante: com `--resume <session_id>` (conversa
 * sobrevive, só o turno em andamento morre) ou do zero (perde a conversa
 * inteira, de propósito).
 *
 * Por isso ele NÃO é toque simples como o destrava. O destrava manda Escape,
 * idempotente — errar o toque não custa nada. Aqui errar o toque custa caro
 * nos dois modos (o resume perde o turno em voo, o fresco perde tudo). O
 * gesto é o mesmo já usado no destrava-durante-compact (armar e confirmar), e
 * não a pressão longa do cockpit antigo: pressão longa esconde a ação de quem
 * está com pressa, e este botão existe justamente para a hora em que o canal
 * do agente morreu e o Rica precisa dele de volta.
 *
 * O `ModoRelancar` (`resume`/`fresco`) mora nas funções de tradução, não
 * neste tipo: as duas variantes são o mesmo botão com o mesmo ciclo de fase,
 * só mudando a régua e o `resume` que vai pro back — não duas máquinas. Os
 * dois modos também compartilham o MESMO estado no componente (`useRelancar`
 * em `bloco-de-acoes.tsx`), não duas instâncias — só um pode sair de `ocioso`
 * por vez, o que evita o dedo disparar os dois relançamentos ao mesmo tempo.
 */
export type FaseRelancar = 'ocioso' | 'confirmando' | 'enviando' | 'relancado';

/** Quanto tempo a confirmação do relançar fica armada. Mais longa que a do
 *  destrava-durante-compact (4s): ali o segundo toque é reflexo de quem já
 *  decidiu, aqui a frase avisa que o turno atual morre e merece ser lida. */
export const CONFIRMA_RELANCAR_MS = 6_000;

/** Espera da primeira retentativa do `/painel` depois de ele ter caído, e teto
 *  do crescimento. Painel fora do ar não pode virar estado permanente: um
 *  restart da API de 6 segundos apagava os controles da tela até o Rica fechar
 *  e reabrir a gaveta, e o que ele via era o botão sumindo sozinho e não
 *  voltando mais. Começa curto porque a causa comum é justamente um restart —
 *  e cresce até 15s para não martelar uma API que está de fato fora. */
export const RETENTA_PAINEL_BASE_MS = 2_000;
export const RETENTA_PAINEL_TETO_MS = 15_000;

/** `fresco` é o boot sem `--resume` — perde a conversa inteira, não só o
 *  turno em voo, daí o aviso de confirmação ser mais forte que o do resume. */
export type ModoRelancar = 'resume' | 'fresco';

/** Rótulo SEMPRE curto — os três botões (Destravar/Resume/Restart) dividem
 *  ~110px na gaveta de 380px (§ auditoria 03/08: a frase longa de confirmação
 *  cortava em elipse, e `text-overflow` nem se aplica dentro de um flex —
 *  cortava sem reticências, sumindo com "tocar de novo confirma", que é
 *  justamente o aviso que evita o toque acidental). A frase completa mora só
 *  em `descreveRelancar` (aria-label + aviso visível de largura cheia,
 *  renderizado fora do botão). */
export function rotulaRelancar(fase: FaseRelancar, modo: ModoRelancar = 'resume'): string {
  if (fase === 'confirmando') return 'Confirmar?';
  if (fase === 'enviando') return 'Relançando…';
  if (fase === 'relancado') return 'Relançado';
  return modo === 'fresco' ? 'Restart' : 'Resume';
}

/** A frase completa — SEMPRE, em toda fase (não só o ocioso). Serve dois
 *  papéis: nome acessível (WCAG 2.5.3, começa pelo rótulo curto do botão) e,
 *  quando `fase === 'confirmando'`, o texto do aviso visível de largura cheia
 *  que substitui o que cortava dentro do botão. */
export function descreveRelancar(fase: FaseRelancar, modo: ModoRelancar = 'resume'): string {
  const rotulo = rotulaRelancar(fase, modo);
  if (fase === 'enviando' || fase === 'relancado') return rotulo;
  if (fase === 'confirmando') {
    return modo === 'fresco'
      ? `${rotulo} Apaga a conversa e recomeça — tocar de novo confirma`
      : `${rotulo} Mata o turno atual — tocar de novo confirma`;
  }
  return modo === 'fresco'
    ? `${rotulo}: relança o Claude Code do agente do zero — perde a conversa inteira, não só o turno em andamento`
    : `${rotulo}: relança o Claude Code do agente retomando a conversa atual — o turno em andamento é perdido`;
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
  esforco: 'o esforço',
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
  if (texto.includes('not_allowed')) {
    return {
      resumo: `o back recusou esse nível para este motor`,
      saida: 'cada família tem a escala dela — recarregue o painel para pegar a lista atual',
    };
  }
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
