/**
 * O motor — como o modelo e o esforço aparecem DENTRO do composer (§12.2).
 *
 * Por que isto existe como módulo puro: a referência do Rica mostra `5.6 Sol
 * Extra alto` embaixo, à direita, a um toque de onde se escreve. Nós já temos
 * três famílias de modelo (Anthropic, Codex, Kimi) com escalas de esforço
 * DIFERENTES, e o nome cru que o back guarda (`claude-opus-5`,
 * `codex-gpt-5-6-sol`, `kimi-for-coding-highspeed`) não é o que se põe numa
 * linha de 390px. A tradução mora aqui, testada, e não espalhada em JSX.
 *
 * Duas regras que vieram do próprio back e que a pele não pode desobedecer:
 *
 * 1. **`session_may_diverge`** — o back diz, com todas as letras, que o valor
 *    que ele leu do arquivo pode não ser o que a sessão está usando agora. Um
 *    controle que exibe isso como fato é mentira de UI (§9). Então há dois
 *    graus de certeza, e eles são visíveis: valor lido da sessão vem em texto
 *    primário; valor que pode ter divergido vem em secundário, com a ressalva
 *    escrita no `title`/`aria-label`, não escondida.
 *
 * 2. **Escala de esforço é por família.** Kimi não tem `medium` nem `xhigh`
 *    (só `low`/`high`/`max`); o Codex ganhou `max` junto com o gpt-5.6-luna
 *    (0.146+). Oferecer no seletor um degrau que o back vai recusar com 400 é
 *    pior do que não oferecer — a lista vem do back (`effort.allowed`) e a pele
 *    só a traduz.
 *
 * Módulo neutro de propósito: sem `'use client'`. É consumido por Server
 * Component (o cabeçalho lê o fleet no servidor) e por Client Component (o
 * composer). Marcar como cliente aqui contaminaria o servidor.
 */
import { shortModelName } from '@grupo_borges/cockpit-core/cockpit-types';

export type GrauDeCerteza = 'lido' | 'pode-divergir';

export type Motor = {
  /** `Opus 5`, `5.6 Sol`, `K2.7 code`. Nunca o slug cru. */
  modelo: string;
  /** `alto`, `extra alto`. `null` quando o back não sabe. */
  esforco: string | null;
  certeza: GrauDeCerteza;
};

/** Kimi chega em duas grafias: o slug do cockpit e o nome cru do provedor. A
 *  tabela canônica (`shortModelName`, abaixo) não cobre Kimi — só Anthropic e
 *  Codex —, então esta parte é genuinamente nova, não duplicada. */
const KIMI: Record<string, string> = {
  'kimi-k3': 'K3',
  k3: 'K3',
  'kimi-k2.7-code': 'K2.7 code',
  'kimi-for-coding': 'K2.7 code',
  'kimi-k2.7-code-highspeed': 'K2.7 rápido',
  'kimi-for-coding-highspeed': 'K2.7 rápido',
};

/** `state_model` às vezes chega como ALIAS CURTO — vi isto ao rodar a página
 *  real: o Daniel tinha `state_model: 'opus'`, sem versão nenhuma. Nem a
 *  tabela canônica cobre esse formato (ela só tem os slugs completos,
 *  `claude-opus-5` etc.), e sem versão não dá pra inventar uma — dizer
 *  "Opus 5" quando a sessão pode estar em 4.8 é mentira de UI. Por isso o
 *  alias cru vira só a FAMÍLIA, sem número. */
const ALIAS_CURTO: Record<string, string> = {
  opus: 'Opus',
  sonnet: 'Sonnet',
  haiku: 'Haiku',
  fable: 'Fable',
};

export function rotulaModelo(modelo: string | null | undefined): string {
  if (!modelo) return 'sem modelo';

  const kimi = KIMI[modelo];
  if (kimi) return kimi;

  const alias = ALIAS_CURTO[modelo];
  if (alias) return alias;

  // Anthropic e Codex vêm da MESMA tabela que a tropa/statusline já usa
  // (`shortModelName`, `cockpit-core/cockpit-types.ts`). Eu tinha desenhado
  // uma tabela própria aqui e ela divergiu da canônica sem eu perceber —
  // `codex-gpt-5-6-sol` virava "5.6 Sol" nesta peça e "GPT-5.6 Sol" em todo
  // o resto do cockpit. Reusar a fonte única é a mesma lição da `estado.ts`:
  // duas cópias da mesma tradução é como elas divergem em silêncio.
  return shortModelName(modelo);
}

const ESFORCO: Record<string, string> = {
  low: 'baixo',
  medium: 'médio',
  high: 'alto',
  xhigh: 'extra alto',
  max: 'máximo',
  // Fora da escala crescente: `auto` não é um degrau, é o Claude Code
  // escolhendo o nível conforme a tarefa. Quem decide se ele entra no menu é
  // o back (`effort.allowed`) — aqui mora só a tradução, não a oferta.
  auto: 'automático',
};

export function rotulaEsforco(esforco: string | null | undefined): string | null {
  if (!esforco) return null;
  return ESFORCO[esforco] ?? esforco;
}

/** No que a troca de esforço desaguou DE FATO, lido do corpo do PATCH. O back
 *  é honesto: 200 não é sinônimo de aplicado — o /effort pode não ter sido
 *  entregue à sessão tmux, ou ter sido entregue e ficado pendente porque o
 *  agente estava no meio de um turno (a troca enfileira; o diálogo de
 *  confirmação do CC pode até recusá-la). Só a confirmação da sessão pinta o
 *  card. */
export type DesfechoEsforco = 'aplicado' | 'entrega-falhou' | 'pendente';

export function desfechoDaTrocaDeEsforco(resposta: {
  written: boolean;
  tmux_delivered?: boolean | null;
  confirmed?: boolean | null;
}): DesfechoEsforco {
  // `=== false` e não falsy: os caminhos Codex/Kimi não têm entrega tmux — o
  // campo chega null/ausente e NÃO pode derrubar uma troca que foi só gravada.
  if (!resposta.written || resposta.tmux_delivered === false) return 'entrega-falhou';
  if (resposta.confirmed === false) return 'pendente';
  return 'aplicado';
}

/** Quais motores têm `requested` no contrato do painel: Kimi e Codex (commits
 *  dac720c/f9a6bd8 do Daniel). No Claude o campo é SEMPRE null — lá, null
 *  significa "o contrato não cobre", nunca "ninguém pediu". Sem esta pergunta,
 *  todo Claude ganharia a etiqueta de default, inclusive o que está em `max`
 *  porque o Rica pediu — a mentira que o caso 3 existe para evitar. */
export function contratoSeparaPedido(agente: {
  executor_kind?: string | null;
  model_family?: string | null;
}): boolean {
  return agente.executor_kind === 'codex' || agente.model_family === 'kimi';
}

/** A etiqueta ao lado do valor do esforço — uma palavra, ou NADA.
 *
 *  O `painel.effort` carrega o valor EFETIVO ao lado do PEDIDO. Três estados,
 *  e confundir dois deles é o erro que esta máquina existe para evitar:
 *
 *  1. **Convergiu** (pedido = efetivo): o caso normal. `null` — nenhuma
 *     etiqueta, o painel não polui.
 *  2. **Divergiu** (pediu `high`, a sessão roda outra coisa): `diverge`.
 *  3. **Ninguém pediu** (`requested` null COM fonte viva): o valor é o default
 *     do motor, não decisão de alguém — `padrão`, e o título diz "ninguém
 *     escolheu". Dar a entender que alguém escolheu seria mentira.
 *
 *  Leitura fraca (`session_may_diverge`) ou motor que o contrato não cobre
 *  devolvem `null`: etiqueta inventada sobre dado fraco é pior que ausência.
 *
 *  A explicação por extenso vai no `titulo` (title/aria) — texto explicativo
 *  na tela foi revogado pelo Rica em 30/07 e continua revogado. */
export type EtiquetaEsforco = {
  /** A palavra curta ao lado do valor — mesma gramática da etiqueta `antigo`. */
  palavra: string;
  /** A explicação, para `title`/aria — nunca texto visível na tela. */
  titulo: string;
};

export function etiquetaDoEsforco(
  esforco: {
    value: string | null;
    requested?: string | null;
    session_may_diverge: boolean;
  } | null,
  cobrePedido: boolean,
): EtiquetaEsforco | null {
  if (!esforco || !cobrePedido || esforco.session_may_diverge || esforco.value == null) return null;

  if (esforco.requested == null) {
    return {
      palavra: 'padrão',
      titulo: 'Ninguém escolheu este nível — é o padrão do motor.',
    };
  }

  if (esforco.requested === esforco.value) return null;

  return {
    palavra: 'diverge',
    titulo: `Pedido ${rotulaEsforco(esforco.requested)} — a sessão está rodando ${rotulaEsforco(esforco.value)}.`,
  };
}

export function leMotor(entrada: {
  modeloSessao?: string | null;
  modeloPadrao?: string | null;
  esforco?: string | null;
  podeDivergir?: boolean;
}): Motor {
  // `state_model` é o que a sessão respondeu; `model_default` é o que está
  // escrito na config. Preferir o primeiro não é otimização: é a diferença
  // entre mostrar o motor que está rodando e o que deveria estar.
  const daSessao = entrada.modeloSessao ?? null;
  const modelo = daSessao ?? entrada.modeloPadrao ?? null;

  return {
    modelo: rotulaModelo(modelo),
    esforco: rotulaEsforco(entrada.esforco),
    // Sem valor de sessão, o que sobrou foi a config — e config é justamente o
    // caso em que o back avisa que a sessão pode ter divergido.
    certeza: entrada.podeDivergir === false && daSessao ? 'lido' : 'pode-divergir',
  };
}

/** O texto do controle. Ponto médio separa os dois porque eles são a mesma
 *  decisão em dois eixos — vírgula sugeriria lista, barra sugeriria alternativa. */
export function textoDoMotor(motor: Motor): string {
  return motor.esforco ? `${motor.modelo} · ${motor.esforco}` : motor.modelo;
}

/** O que o leitor de tela e o toque-e-segura dizem. Aqui a ressalva do back
 *  aparece por extenso: o resumo visual não tem espaço para ela, mas ela não
 *  pode sumir — é a diferença entre um controle honesto e um enfeite. */
export function descreveMotor(motor: Motor): string {
  const base = motor.esforco
    ? `Motor: ${motor.modelo}, esforço ${motor.esforco}`
    : `Motor: ${motor.modelo}`;
  return motor.certeza === 'pode-divergir'
    ? `${base}. Lido da configuração — a sessão em execução pode estar em outro valor.`
    : base;
}
