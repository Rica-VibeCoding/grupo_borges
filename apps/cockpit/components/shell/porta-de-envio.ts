/**
 * A PORTA DO ENVIO — decide se um gesto pode sair e, quando não pode, o que a
 * tela tem de dizer.
 *
 * Existe por um incidente: em 05/08 o Rica escreveu, o campo esvaziou e a
 * mensagem nunca virou requisição. Ela morreu num `return` mudo dentro do
 * composer, com o campo já limpo — não sobrou rastro em lugar nenhum, nem no
 * servidor, nem na tela. Eram três portões assim, e todos descartavam calados.
 *
 * A regra que este módulo carrega é uma só: **recusa com texto na mão SEMPRE
 * tem recado.** Silêncio é o defeito; o `recado` nulo só existe para o campo
 * vazio, onde não há gesto nem texto a preservar.
 *
 * Função pura de propósito. Dentro do componente a decisão não era observável
 * por teste nenhum — e defeito que só a tela do Rica enxerga chega nele antes
 * de chegar na suíte.
 */
import type { FaseEnvio } from '../../lib/envio.ts';

export type MotivoRecusa =
  /** Não há gesto: o campo está vazio. */
  | 'vazio'
  /** O `/compact` está em voo e uma mensagem agora corta o resumo ao meio. */
  | 'compactando'
  /** A mensagem anterior ainda não foi confirmada pelo eco. */
  | 'envio-em-voo';

export type PortaDeEnvio =
  | { libera: true }
  | {
      libera: false;
      motivo: MotivoRecusa;
      /** `null` só em `vazio` — nos demais, dizer é obrigatório. */
      recado: string | null;
    };

/**
 * O que a espera É e o que acontece com o que ele produziu. A segunda metade
 * não é gentileza: sem ela o Rica não sabe se pode sair da tela.
 *
 * Os recados da voz são OUTROS de propósito. O texto fica no campo e volta com
 * um toque; o áudio recusado não tem onde ficar — dizer a ele "continua aqui"
 * seria a mesma mentira de UI que este módulo existe para matar.
 */
const RECADO: Record<'texto' | 'voz', Record<Exclude<MotivoRecusa, 'vazio'>, string>> = {
  texto: {
    compactando: 'compactando — sua mensagem continua aqui e sai quando a barra sumir',
    'envio-em-voo':
      'a mensagem anterior ainda não voltou confirmada — sua mensagem continua aqui',
  },
  voz: {
    compactando: 'compactando — o áudio não foi enviado, grave de novo quando a barra sumir',
    'envio-em-voo':
      'a mensagem anterior ainda não voltou confirmada — o áudio não foi enviado',
  },
};

/**
 * `texto` ausente é o caminho da VOZ: ali o texto só existe depois do STT, e
 * "campo vazio" não é uma recusa possível.
 */
export function abrePorta(entrada: {
  texto?: string;
  compactando: boolean;
  faseEnvio: FaseEnvio;
  midia?: 'texto' | 'voz';
}): PortaDeEnvio {
  const recado = RECADO[entrada.midia ?? 'texto'];
  if (entrada.texto !== undefined && !entrada.texto.trim()) {
    return { libera: false, motivo: 'vazio', recado: null };
  }
  if (entrada.compactando) {
    return { libera: false, motivo: 'compactando', recado: recado.compactando };
  }
  // Espelha a guarda de `executar` em `lib/usa-envio.ts`. Ela continua lá como
  // defesa da máquina; a diferença é que agora alguém pergunta ANTES de limpar
  // o campo, então a recusa devolve o texto em vez de engoli-lo.
  if (entrada.faseEnvio === 'enviando' || entrada.faseEnvio === 'aceito') {
    return { libera: false, motivo: 'envio-em-voo', recado: recado['envio-em-voo'] };
  }
  return { libera: true };
}

/** O que o composer faz com o gesto: despachar, esvaziar o campo, avisar. */
export type EfeitoEnvio = {
  despacha: boolean;
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
   */
  limpaCampo: boolean;
  aviso: string | null;
};

export function preparaEnvio(entrada: {
  texto?: string;
  compactando: boolean;
  faseEnvio: FaseEnvio;
  midia?: 'texto' | 'voz';
}): EfeitoEnvio {
  const porta = abrePorta(entrada);
  if (porta.libera) return { despacha: true, limpaCampo: true, aviso: null };
  return { despacha: false, limpaCampo: false, aviso: porta.recado };
}
