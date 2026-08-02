/**
 * Leitura do `pane_excerpt` — a captura crua do tmux.
 *
 * O statusline do Claude Code aponta a sessão no claude.ai por OSC 8, o
 * hyperlink de terminal: `ESC ] 8 ; id=… ; URI ST` + rótulo + `ESC ] 8 ; ; ST`.
 *
 * O DETALHE QUE ME PEGOU: quando isso chega no `/api/fleet`, **o byte ESC já foi
 * removido** — sobra o texto literal `]8;id=…;https://…\` com a barra invertida
 * órfã do terminador. Meu primeiro limpador exigia `\x1b\]` e por isso nunca
 * casou uma vez: virou no-op silencioso, passou no tsc, passou nos testes, e o
 * lixo continuou na tela até o print chegar no Pavan. É por isso que este módulo
 * é separado e tem teste — regex que falha calada não pode depender de alguém
 * reparar num print.
 *
 * OSC 8 também não é CSI, então nenhum removedor de ANSI comum pega.
 */

/** Abertura + rótulo + fechamento, numa casada só. */
const OSC8 = /\]8;[^;\\]*;([^\\]*)\\([\s\S]*?)\]8;;\\/g;
/** Sobra de abertura sem par — pane truncado no meio do link. */
const OSC8_ORFAO = /\]8;[^\\]*\\/g;

/**
 * O chrome do CLI que não é conversa — ordem do Rica, 02/08: "nada do painel
 * do terminal entra no feed; statusline, Tip, barras de contexto e linhas em
 * branco são chrome do CLI, o estado do agente já vive na tropa e no
 * cabeçalho".
 *
 * A lista é por LINHA INTEIRA e deliberadamente estreita: cada regra casou com
 * chrome real medido no pane (não com o que poderia existir). Ela envelhece —
 * o CC muda o statusline e uma regra nova nasce aqui; o que não se faz é
 * alargar a regex até ela morder log de verdade. `--- tsc ---` (hífen ASCII)
 * NÃO é o separador de caixa (U+2500) e atravessa — há teste que trava isso.
 */
const CHROME_DA_LINHA: RegExp[] = [
  /\[[#█░■]{2,}\]\s*\d+%/, // barra de contexto: "[###] 21%"
  /⏵⏵/, // indicador de modo
  /bypass permissions on/i,
  /^[\s]*[✻✽✶✳✢]/, // o resumo animado: "✻ Worked for 3m…"
  /^[\s]*[⠋⠙⠚⠞⠖⠦⠴⠲⠳⠓]/, // spinner braille
  /^[\s]*─{5,}[\s]*$/, // separador de caixa, a linha inteira (U+2500)
  /^[\s]*❯[\s]*$/, // o prompt vazio
  /^[\s]*Tip:/, // "Tip: Use /btw"
  /Esc to interrupt/,
];

/**
 * Tira o chrome e colapsa os vazios: runs de linhas em branco viram no máximo
 * uma, e as bordas não acumulam. A quebra final do texto original sobrevive
 * (ela é o `\n` entre este trecho e o próximo, não chrome).
 */
function filtraChrome(texto: string): string {
  const linhas = texto.split('\n');
  const saida: string[] = [];
  let brancoPendente = false;

  for (const linha of linhas) {
    if (CHROME_DA_LINHA.some((regra) => regra.test(linha))) continue;
    if (!/\S/.test(linha)) {
      brancoPendente = true;
      continue;
    }
    if (brancoPendente && saida.length > 0) saida.push('');
    brancoPendente = false;
    saida.push(linha);
  }
  // O vazio do fim fecha a última linha (é a quebra final do trecho).
  if (brancoPendente && saida.length > 0) saida.push('');
  return saida.join('\n');
}

export type TrechoPane =
  | { tipo: 'texto'; texto: string }
  | { tipo: 'link'; texto: string; href: string };

/**
 * Só `http`/`https` viram link. O conteúdo vem de captura de terminal, e um
 * `javascript:` aqui seria execução a partir de dado — barato de barrar, caro de
 * descobrir depois.
 */
function hrefSeguro(bruto: string): string | null {
  try {
    const u = new URL(bruto.trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

/** Quebra o pane em texto e links, na ordem em que aparecem. */
export function lePane(bruto: string): TrechoPane[] {
  const trechos: TrechoPane[] = [];
  let cursor = 0;

  const empilhaTexto = (cru: string) => {
    const texto = filtraChrome(cru.replace(OSC8_ORFAO, ''));
    if (texto) trechos.push({ tipo: 'texto', texto });
  };

  OSC8.lastIndex = 0;
  for (let m = OSC8.exec(bruto); m !== null; m = OSC8.exec(bruto)) {
    empilhaTexto(bruto.slice(cursor, m.index));
    const href = hrefSeguro(m[1] ?? '');
    // Rótulo vazio acontece (o CC usa o link só pra marcar a sessão): cai pro
    // endereço, senão vira um link invisível de zero caractere.
    const rotulo = (m[2] ?? '').trim() || href || '';
    if (href) trechos.push({ tipo: 'link', texto: rotulo, href });
    else empilhaTexto(m[2] ?? '');
    cursor = m.index + m[0].length;
  }

  empilhaTexto(bruto.slice(cursor));
  return trechos;
}
