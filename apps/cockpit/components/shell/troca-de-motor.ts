/**
 * A régua do "trocar motor" da gaveta (Fase 2) — sem React e sem pixel, como
 * `acoes-rapidas.ts` e `cota.ts`.
 *
 * O que este módulo decide é o que a tela não pode decidir sozinha: qual família
 * está em vigor, o que a escolha desencadeia e a palavra de cada opção. A regra
 * que manda sobre tudo veio do Rica (09/09): **matriz cheia, todo agente pode ir
 * pra toda família, e NENHUMA preferência de motor mora no código** — quem
 * escolhe é ele, na hora, com a cota na frente. Por isso a ordem da lista aqui é
 * alfabética e nada mais: alfabeto não é ranking.
 *
 * O contrato com o back (Daniel, mesmo dia): a escolha persiste em
 * `agent_state.motor_familia` e **só vale no próximo boot** — sessão viva não
 * troca de motor (thinking blocks assinados por modelo não sobrevivem à troca de
 * família). O painel devolve a família EFETIVA (`motor.familia` = escolha do
 * override ou o `agents.model_family` do yaml) ao lado do `override` (só a
 * escolha; `null` = herda o yaml).
 */
import type {
  MotorFamilia,
  PainelMotor,
} from '@grupo_borges/cockpit-core/cockpit-types';

/** Rótulo curto que cabe na linha da gaveta (390px). O padrão do yaml é a
 *  AUSÊNCIA de campo e representa o Anthropic — nunca inventar quinta família. */
const ROTULOS: Record<MotorFamilia, string> = {
  anthropic: 'Anthropic',
  'codex-proxy': 'Codex',
  kimi: 'Kimi',
  opencode: 'OpenCode',
};

/** As quatro famílias da matriz cheia, em ordem ALFABÉTICA — neutra de
 *  propósito. Não há caminho preferido nem agente amarrado a uma família. */
export const ORDEM_DE_FAMILIAS: readonly MotorFamilia[] = [
  'anthropic',
  'codex-proxy',
  'kimi',
  'opencode',
];

/** O nome que o leitor de tela e o rótulo do gatilho usam para a família em
 *  vigor. Família desconhecida não estoura: mostra o nome cru — o código não
 *  congela a verdade do catálogo de terceiro. */
export function rotulaFamilia(familia: string | null | undefined): string {
  if (!familia) return 'Padrão (Anthropic)';
  return ROTULOS[familia as MotorFamilia] ?? familia;
}

export type OpcaoDeFamilia = {
  chave: MotorFamilia | 'herda';
  rotulo: string;
  selecionado: boolean;
};

/** As opções do menu. A marcação `✓` segue a família EFETIVA (`motor.familia`):
 *  quando há override, ela é o escolhido; sem override, é a do yaml — os dois
 *  casos são "o que roda depois do próximo boot". O item "voltar ao padrão"
 *  só existe quando há override pra limpar; sem escolha não há o que reverter. */
export function opcoesDeFamilia(motor: PainelMotor | null | undefined): OpcaoDeFamilia[] {
  const atual = motor?.familia ?? null;
  const opcoes: OpcaoDeFamilia[] = ORDEM_DE_FAMILIAS.map((chave) => ({
    chave,
    rotulo: ROTULOS[chave],
    selecionado: atual === chave,
  }));
  if (motor?.override != null) {
    opcoes.push({ chave: 'herda', rotulo: 'Voltar ao padrão do agents.yaml', selecionado: false });
  }
  return opcoes;
}

export type DestinoDaTroca =
  | { acao: 'trocar'; familia: MotorFamilia | null }
  | { acao: 'nenhuma' };

/** O que um clique numa opção deve mandar pro back. `null` (o item "herdar")
 *  é uma troca legítima — limpa o override; por isso "já é o atual" e "limpar"
 *  são destinos diferentes e nenhuma chamada sai quando o clique não muda nada.
 *
 *  "Já é o atual" compara com a família EFETIVA (`motor.familia`), não com o
 *  `override`: com override presente os dois coincidem, mas sem override
 *  escolher a própria família do yaml também não muda nada — e pinar um
 *  override igual ao yaml só criaria um "voltar ao padrão" à toa. */
export function destinoDaTroca(
  motor: PainelMotor | null | undefined,
  chave: MotorFamilia | 'herda',
): DestinoDaTroca {
  if (!motor) return { acao: 'nenhuma' };
  if (chave === 'herda') {
    return motor.override == null ? { acao: 'nenhuma' } : { acao: 'trocar', familia: null };
  }
  if (motor.familia === chave) return { acao: 'nenhuma' };
  return { acao: 'trocar', familia: chave };
}

/** A ressalva que o Daniel mandou deixar VISÍVEL no próprio controle: a troca
 *  só entra no próximo boot. Sessão viva não muda — quem aplica é Desligar +
 *  Ligar, e o botão que faz isso já mora na mesma gaveta. */
export const TEXTO_VALE_NO_BOOT = 'Vale no próximo boot — Desligar e Ligar aplicam.';
