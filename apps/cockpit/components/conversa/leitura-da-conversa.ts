import type { MotivoDeErro } from '@/lib/conversa/tipos';

import { mensagemDeErro } from './mensagem-de-erro.ts';
import type { Cena } from './moldura-estado.ts';

/** O que a tela escreve. Curto: quem ouve olha de relance, a cor diz o resto. */
export type Leitura = { titulo: string; detalhe: string };

export type EntradaDaLeitura = {
  cena: Cena;
  preparacaoFalhou: boolean;
  abrindoMicrofone: boolean;
  falaDetectada: boolean;
  fone: boolean;
  motivo?: MotivoDeErro;
};

const TITULO_DO_ERRO: Record<MotivoDeErro, string> = {
  microfoneNegado: 'Sem acesso ao microfone',
  capturaCaiu: 'O microfone desligou',
  transcricaoFalhou: 'Não entendi o áudio',
  transcricaoVazia: 'Não ouvi uma frase',
  envioFalhou: 'A mensagem não saiu',
  agenteOcupado: 'O agente está ocupado',
};

export function leituraDaConversa(e: EntradaDaLeitura): Leitura {
  if (e.preparacaoFalhou) {
    return { titulo: 'O detector não carregou', detalhe: 'Recarregue a página para tentar de novo.' };
  }
  if (e.abrindoMicrofone) {
    return { titulo: 'Liberando o microfone', detalhe: 'Autorize o acesso para começar.' };
  }
  switch (e.cena) {
    case 'preparando':
      return { titulo: 'Preparando', detalhe: 'Baixando o detector de voz neste aparelho.' };
    case 'parado':
      return { titulo: 'Conversa por voz', detalhe: 'Um toque para começar. Depois é só falar.' };
    case 'ouvindo':
      return e.falaDetectada
        ? { titulo: 'Estou ouvindo', detalhe: 'Quando você parar, eu envio.' }
        : { titulo: 'Pode falar', detalhe: 'O microfone está aberto.' };
    case 'transcrevendo':
      return { titulo: 'Entendendo', detalhe: 'Passando sua fala para texto.' };
    case 'esperandoZe':
      return { titulo: 'Pensando', detalhe: 'A resposta toca assim que chegar.' };
    case 'falando':
      return {
        titulo: 'Respondendo',
        detalhe: e.fone ? 'Fale por cima para interromper.' : 'Quando ele terminar, volto a ouvir.',
      };
    case 'interrompendo':
      return { titulo: 'Pausei a resposta', detalhe: 'Continue falando para interromper. Se foi tosse, eu retomo.' };
    case 'erro':
      return {
        titulo: e.motivo ? TITULO_DO_ERRO[e.motivo] : 'A conversa parou',
        detalhe: mensagemDeErro(e.motivo),
      };
  }
}

/** O botão principal: o mesmo nome do começo ao fim de cada ação. */
export function rotuloDaAcao(cena: Cena, preparacaoFalhou: boolean): string {
  if (preparacaoFalhou) return 'Detector indisponível';
  if (cena === 'preparando') return 'Preparando…';
  if (cena === 'parado') return 'Começar conversa';
  if (cena === 'erro') return 'Retomar conversa';
  return 'Encerrar conversa';
}

/** Onde cada fala aparece: a sua depois de transcrita; a dele enquanto responde. */
export function falasVisiveis(cena: Cena): { voce: 'cheia' | 'recuada' | null; ze: boolean } {
  if (cena === 'falando' || cena === 'interrompendo') return { voce: 'recuada', ze: true };
  if (cena === 'transcrevendo' || cena === 'esperandoZe' || cena === 'erro') return { voce: 'cheia', ze: false };
  return { voce: null, ze: false };
}
