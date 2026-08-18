/**
 * A régua do seletor de conta — rótulo, percentual e qual nome a pílula
 * mostra depois da troca. Sem React e sem pixel, como `cota.ts`.
 *
 * A conta Claude é UMA por máquina (o `.credentials.json` é do usuário, não
 * da sessão), então tudo aqui fala da máquina inteira — nada neste arquivo
 * pode deixar escapar um "deste agente".
 */
import { AgentInputError } from '@grupo_borges/cockpit-core/api';
import type { ContasResponse } from '@grupo_borges/cockpit-core/api';
import { clampPct } from '@grupo_borges/cockpit-core/painel-format';

export type ContaConfirmada = { email: string; display_name: string | null };

/** O nome que o Rica reconhece: o rótulo que ele mesmo deu; sem ele, o pedaço
 *  do email antes do `@` — mesma régua do `leiaConta`. */
export function rotuloDaConta(conta: { rotulo?: string | null; email?: string | null }): string {
  if (typeof conta.rotulo === 'string' && conta.rotulo.trim()) return conta.rotulo;
  if (typeof conta.email === 'string' && conta.email) return conta.email.split('@')[0] || conta.email;
  return 'conta sem nome';
}

/** O nome da conta que o back confirmou — `display_name` primeiro, como o
 *  painel já faz com a conta lida do `.claude.json`. */
export function nomeDaConfirmada(conta: ContaConfirmada): string {
  if (typeof conta.display_name === 'string' && conta.display_name.trim()) {
    return conta.display_name;
  }
  return conta.email.split('@')[0] || conta.email;
}

/** Fração 0..1 → inteiro 0..100. `ceil`, mesma régua do card de cota: bater
 *  com o display do claude.ai, nunca 1pp atrás dele. null = sem leitura, e
 *  sem leitura não vira zero — zero afirma, o traço não. */
export function pctDaFracao(fracao: number | null): number | null {
  if (typeof fracao !== 'number' || !Number.isFinite(fracao)) return null;
  // O card de cota recebe o número já em 0..100 e faz `ceil` direto; aqui ele
  // chega como fração, e a multiplicação por 100 inventa lixo binário —
  // `0.07 * 100` é 7.000000000000001, que o `ceil` promoveria a 8. Cortar na
  // sexta casa apaga o lixo sem alcançar centésimo de verdade.
  const emCem = Math.round(fracao * 100 * 1e6) / 1e6;
  return Math.ceil(clampPct(emCem));
}

export type ContaEmLista = {
  chave: string;
  nome: string;
  email: string;
  ativa: boolean;
  pct5h: number | null;
  pct7d: number | null;
  /** O que o leitor de tela anuncia no item — um "34" sem dono não diz 34 do
   *  quê, nem de quem. */
  valorFalado: string;
};

function falaDaJanela(nomeDaJanela: string, pct: number | null): string {
  return pct === null ? `${nomeDaJanela} sem leitura` : `${nomeDaJanela} ${pct}% usada`;
}

/** A lista pronta pra tela. A ativa se casa por email — é a única chave que
 *  o GET devolve nos dois lugares (`ativa.email` e `contas[].email`). */
export function listaDeContas(resposta: ContasResponse | null | undefined): ContaEmLista[] {
  const emailAtivo = resposta?.ativa?.email ?? null;
  return (resposta?.contas ?? []).map((conta) => {
    const nome = rotuloDaConta(conta);
    const pct5h = pctDaFracao(conta.cota_5h);
    const pct7d = pctDaFracao(conta.cota_7d);
    const ativa = emailAtivo !== null && conta.email === emailAtivo;
    return {
      chave: conta.id,
      nome,
      email: conta.email,
      ativa,
      pct5h,
      pct7d,
      valorFalado: `${nome}${ativa ? ', conta ativa' : ''}, ${falaDaJanela('cota de 5 horas', pct5h)}, ${falaDaJanela('cota de 7 dias', pct7d)}`,
    };
  });
}

/**
 * O nome na pílula. Depois da troca o que vale é o que o back CONFIRMOU, não
 * o que a gaveta já tinha: a conta do painel é lida do `.claude.json` com
 * cache e pode demorar a convergir — deixar a pílula voltar pro nome antigo
 * diria que a troca não pegou, quando pegou.
 *
 * O override morre com a montagem do componente: reabriu a gaveta, quem fala
 * é o painel de novo. Assim uma troca feita por fora (o `/login` manual do
 * Rica no terminal) nunca fica escondida atrás de um estado velho da tela.
 */
export function contaExibida(
  confirmada: ContaConfirmada | null,
  doPainel: string | null,
): string | null {
  if (confirmada) return nomeDaConfirmada(confirmada);
  return doPainel;
}

/**
 * Erro legível da troca: o `detail` do 409 já vem escrito pro Rica e vai
 * inteiro; sem ele, o genérico não finge causa — e não promete estado ("nada
 * foi mexido" seria afirmação que uma falha de rede não permite fazer).
 */
export function mensagemDeErroTroca(erro: unknown): string {
  if (erro instanceof AgentInputError && erro.detail) return erro.detail;
  return 'Não foi possível trocar a conta — tente de novo.';
}
