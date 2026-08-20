/**
 * A PORTA DO ENVIO — decide se um gesto pode sair e, quando não pode, o que a
 * tela tem de dizer.
 *
 * Existe por um incidente: em 05/08 o Rica escreveu, o campo esvaziou e a
 * mensagem nunca virou requisição. Ela morreu num `return` mudo dentro do
 * composer, com o campo já limpo — não sobrou rastro em lugar nenhum, nem no
 * servidor, nem na tela. Eram três portões assim, e todos descartavam calados.
 *
 * A regra que este módulo carrega é uma só: **recusa com gesto na mão SEMPRE
 * tem recado.** Silêncio é o defeito; o `recado` nulo só existe para o gesto
 * vazio, onde não há nada a preservar nem a explicar.
 *
 * Função pura de propósito. Dentro do componente a decisão não era observável
 * por teste nenhum — e defeito que só a tela do Rica enxerga chega nele antes
 * de chegar na suíte.
 */
import type { FaseEnvio } from '../../lib/envio.ts';

// Espelha o `max_length` do endpoint em apps/api/routers/agents.py — o motivo
// do número mora lá, medido. Mexeu num, mexe no outro: acima deste teto o
// backend responde 422 e a mensagem não sai.
export const LIMITE_DE_TEXTO = 65536;

export type MotivoRecusa =
  /** Não há gesto: nem texto escrito, nem arquivo anexado. */
  | 'vazio'
  /** O backend recusa textos acima de `LIMITE_DE_TEXTO`. */
  | 'longo-demais'
  /** O `/compact` está em voo e uma mensagem agora corta o resumo ao meio. */
  | 'compactando'
  /** A mensagem anterior ainda não foi confirmada pelo eco. */
  | 'envio-em-voo'
  /** A sessão do agente ainda está processando o turno anterior E o motor do
   *  outro lado não tem fila própria — ver `motorEnfileiraSozinho`. */
  | 'turno-em-voo'
  /** Um arquivo ainda está subindo — o segundo toque mandaria o mesmo arquivo
   *  duas vezes ao agente. */
  | 'anexo-em-voo';

export type PortaDeEnvio =
  | { libera: true }
  | {
      libera: false;
      motivo: MotivoRecusa;
      /** `null` só em `vazio` — nos demais, dizer é obrigatório. */
      recado: string | null;
    };

const RECADO_ANEXO_EM_VOO =
  'o arquivo anterior ainda está subindo — sua mensagem continua aqui';

/**
 * O compact com ARQUIVO na mão. O texto puro vai para a fila e sai sozinho (ver
 * `EfeitoEnvio.enfileira`); o anexo não — a fila carrega texto, e pendurar um
 * arquivo fora do composer inventaria um segundo lugar onde ele pode estar. Aqui
 * a espera continua sendo manual, então a frase não pode prometer despacho: era
 * essa promessa não cumprida, na linha de baixo, que gerou esta rodada.
 */
const RECADO_COMPACT_COM_ANEXO =
  'compactando — o anexo continua aqui, toque em enviar quando a barra sumir';

type MotivoComRecado = Exclude<MotivoRecusa, 'vazio' | 'anexo-em-voo'>;
type Recados = Record<Exclude<MotivoComRecado, 'longo-demais'>, string> & {
  'longo-demais': (tamanho: number) => string;
};

const RECADO: Recados = {
  compactando: 'compactando — sua mensagem continua aqui e sai quando a barra sumir',
  'envio-em-voo':
    'a mensagem anterior ainda não voltou confirmada — sua mensagem continua aqui',
  'turno-em-voo': 'o agente ainda está respondendo — sua mensagem continua aqui',
  'longo-demais': (tamanho) =>
    `texto longo demais — ${tamanho.toLocaleString('pt-BR')} de ${LIMITE_DE_TEXTO.toLocaleString('pt-BR')} caracteres`,
};

export function abrePorta(entrada: {
  texto?: string;
  /** Há arquivo retido no composer, esperando o toque de enviar. */
  temAnexo?: boolean;
  /** Um upload já está em voo. É a fase da máquina do ANEXO — a de texto não se
   *  move durante uma subida, então `faseEnvio` não cobre este caso. */
  anexoEmVoo?: boolean;
  turnoEmVoo?: boolean;
  /**
   * O motor do outro lado enfileira sozinho o que chega durante um turno.
   *
   * O Claude Code faz: texto colado num pane ocupado vira
   * `queue-operation`/`enqueue` no JSONL e o stream devolve `kind: "queued"` —
   * recibo que a máquina de envio já lê como confirmação (`lib/envio.ts`,
   * campo `fila`). O Codex não faz: o TeleCodex recusa com 409
   * `shared_turn_in_flight`, e a conversa dele é compartilhada com o Telegram.
   *
   * Por isso `turno-em-voo` nasceu (`257d0f9`, 16/08) — para o Codex. Vinha
   * sendo aplicado aos dois motores, e no Claude Code recusava, no cliente,
   * uma entrega que o destino aceita. Falta de informação mantém o portão de
   * pé: só a certeza de que há fila lá fora o levanta.
   */
  motorEnfileiraSozinho?: boolean;
  compactando: boolean;
  faseEnvio: FaseEnvio;
}): PortaDeEnvio {
  // `vazio` é propriedade do GESTO, não do texto. Enquanto anexo e texto eram
  // caminhos separados isso dava no mesmo; com a foto retida no composer, não:
  // o Rica anexa, não escreve legenda nenhuma, toca em enviar — e cairia
  // justamente na ÚNICA recusa muda do módulo. Seria o descarte silencioso de
  // 05/08 renascendo da invariante que o matou.
  if (entrada.texto !== undefined && !entrada.texto.trim() && !entrada.temAnexo) {
    return { libera: false, motivo: 'vazio', recado: null };
  }
  if (entrada.texto !== undefined && entrada.texto.length > LIMITE_DE_TEXTO) {
    return {
      libera: false,
      motivo: 'longo-demais',
      recado: RECADO['longo-demais'](entrada.texto.length),
    };
  }
  if (entrada.compactando) {
    return { libera: false, motivo: 'compactando', recado: RECADO.compactando };
  }
  // Espelha a guarda de `executar` em `lib/usa-envio.ts`. Ela continua lá como
  // defesa da máquina; a diferença é que agora alguém pergunta ANTES de limpar
  // o campo, então a recusa devolve o texto em vez de engoli-lo.
  if (entrada.faseEnvio === 'enviando' || entrada.faseEnvio === 'aceito') {
    return { libera: false, motivo: 'envio-em-voo', recado: RECADO['envio-em-voo'] };
  }
  if (entrada.turnoEmVoo && !entrada.motorEnfileiraSozinho) {
    return { libera: false, motivo: 'turno-em-voo', recado: RECADO['turno-em-voo'] };
  }
  // A trava do duplo envio de arquivo, que a máquina do anexo já fazia CALADA.
  // Ela continua lá como defesa (o `disabled` do botão pode sumir num
  // re-render), mas quem responde ao toque do Rica é esta linha.
  if (entrada.anexoEmVoo) {
    return { libera: false, motivo: 'anexo-em-voo', recado: RECADO_ANEXO_EM_VOO };
  }
  return { libera: true };
}

/** O que o composer faz com o gesto: despachar, enfileirar, esvaziar o campo,
 *  avisar. */
export type EfeitoEnvio = {
  despacha: boolean;
  /**
   * Não sai agora, mas SAI — fica pendurado à vista e o composer despacha
   * sozinho quando o compact terminar (`fila-de-envio.ts`).
   *
   * Existe porque a frase de `RECADO.compactando` era mentira: nada
   * reenviava, e o comentário do composer justificava a ausência de botão
   * dizendo que "não há algo a fazer além de esperar". Agora a promessa tem
   * quem a cumpra, e por isso este é o único caso em que o campo esvazia sem
   * despacho — o texto não evaporou, mudou de lugar, e o lugar novo está na
   * tela com o texto inteiro à mostra.
   */
  enfileira: boolean;
  /**
   * O campo só esvazia quando a tentativa foi despachada. Era o contrário:
   * `composer.tsx` limpava ANTES de chamar a máquina, apostando numa promessa
   * que ainda não tinha sido feita — e quando um portão recusava, ninguém
   * tinha guardado o texto e o campo já estava vazio. Os três descartes de
   * 05/08 eram esse único defeito visto de três ângulos.
   *
   * A limpeza é do instante em que a tentativa é ACEITA, não do instante em
   * que ela é entregue: esperar o POST voltar deixaria o texto no campo
   * durante toda a viagem de rede, convidando um segundo Enter que duplica.
   *
   * E só quando o corpo VEIO do campo — ver `retomada`.
   */
  limpaCampo: boolean;
  aviso: string | null;
  /**
   * Por que recusou. Viaja junto com o `aviso` porque quem o mostra precisa
   * conferir, a cada render, se a recusa ainda descreve o instante — ver
   * `recusaPersiste`. `null` quando a porta liberou ou quando o gesto virou
   * fila, que são os dois casos sem aviso.
   */
  motivo: MotivoRecusa | null;
};

export function preparaEnvio(entrada: {
  texto?: string;
  temAnexo?: boolean;
  anexoEmVoo?: boolean;
  turnoEmVoo?: boolean;
  motorEnfileiraSozinho?: boolean;
  compactando: boolean;
  faseEnvio: FaseEnvio;
  /**
   * O corpo veio da MÁQUINA, não do campo: é o "Reenviar"/"Tentar de novo" da
   * linha de estado, que despacha o texto pendurado de uma tentativa anterior.
   *
   * O campo, nesse instante, guarda outra coisa — o que o Rica escreveu
   * enquanto olhava a faixa de erro (o textarea nunca é `disabled` justamente
   * para isso). Esvaziá-lo não limparia o gesto: comeria uma mensagem que
   * nunca virou requisição, calada, que é o descarte de 05/08 que este módulo
   * existe para matar. Fica na porta, e não num `if` no componente, porque
   * "quando o campo pode esvaziar" é a decisão que este módulo carrega.
   */
  retomada?: boolean;
}): EfeitoEnvio {
  const porta = abrePorta(entrada);
  if (porta.libera) {
    return {
      despacha: true,
      enfileira: false,
      limpaCampo: !entrada.retomada,
      aviso: null,
      motivo: null,
    };
  }
  // A FILA. Só o texto puro, nas duas esperas que o Rica não controla:
  //
  // - `compactando` — a espera do resumo.
  // - `envio-em-voo` — a mensagem anterior ainda não voltou confirmada. Entrou
  //   aqui em 15/08: a premissa antiga era que esta espera "dura o tempo de uma
  //   viagem de rede", e isso só valia no Claude Code, onde o eco volta em
  //   milissegundos. Na Tara ela espera o rollout do `codex exec` — 14 s medidos
  //   em 11/08, registrados em `aparencia-envio.ts`. Nesses 14 s o Rica escrevia,
  //   apertava Enter e o texto ficava parado no campo com um aviso que, no
  //   celular com o teclado de pé, nasce fora da área visível. Da tela dele:
  //   mensagem engolida. Agora ela sai das mãos, aparece no bloco acima do
  //   composer — que o teclado não cobre — e é despachada sozinha quando o eco
  //   da anterior chega.
  // - `temAnexo` fica de fora — a fila carrega texto, e pendurar um arquivo fora
  //   do composer inventaria um segundo lugar onde ele pode estar.
  // - `retomada` fica de fora — o corpo veio da máquina, que já o guarda com o
  //   botão de reenviar do lado; enfileirar criaria uma segunda cópia do mesmo
  //   texto em dois lugares que não sabem um do outro.
  // - `anexo-em-voo` continua de fora: é a espera de uma subida, e o gesto que
  //   ela segura carrega arquivo — mesmo motivo do `temAnexo`.
  const vaiParaFila =
    (porta.motivo === 'compactando' || porta.motivo === 'envio-em-voo') &&
    !entrada.temAnexo &&
    !entrada.retomada;
  if (vaiParaFila) {
    // Sem aviso: o bloco da fila JÁ diz o que vai acontecer, com o texto à
    // vista. Repetir a frase embaixo dele seria dizer duas vezes a mesma coisa
    // em dois lugares — e a segunda, sem o texto, diria menos.
    return { despacha: false, enfileira: true, limpaCampo: true, aviso: null, motivo: null };
  }
  const aviso =
    porta.motivo === 'compactando' && entrada.temAnexo ? RECADO_COMPACT_COM_ANEXO : porta.recado;
  return { despacha: false, enfileira: false, limpaCampo: false, aviso, motivo: porta.motivo };
}

/**
 * A recusa guardada ainda descreve o instante?
 *
 * O aviso da porta não pode sobreviver ao motivo — um "o agente ainda está
 * respondendo" parado na tela depois que o agente parou é mentira. Até 20/08
 * quem apagava era um efeito no composer olhando quatro flags combinadas, e
 * `longo-demais` ficava de fora dessas quatro: o aviso de texto grande ficava
 * preso mesmo depois de o texto encurtar, até o toque seguinte.
 *
 * Aqui não há lista para manter em dia. A pergunta é a mesma que o gesto fez,
 * refeita com as condições de agora: se a porta recusaria de novo pelo MESMO
 * motivo, o aviso continua verdadeiro. Motivo diferente não reescreve o aviso
 * sozinho — sem gesto novo, não há recado novo.
 */
export function recusaPersiste(
  motivo: MotivoRecusa,
  entrada: Parameters<typeof abrePorta>[0],
): boolean {
  const porta = abrePorta(entrada);
  return !porta.libera && porta.motivo === motivo;
}
