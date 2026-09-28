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
  escutaMuda: 'Parei de te ouvir',
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
    case 'trabalhando':
      return { titulo: 'Trabalhando', detalhe: 'Usando ferramentas para responder.' };
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

/** O nome do toque na tela (rótulo acessível, sem texto visível). */
export function rotuloDaAcao(cena: Cena, preparacaoFalhou: boolean): string {
  if (preparacaoFalhou) return 'Detector indisponível';
  if (cena === 'preparando') return 'Preparando…';
  if (cena === 'parado') return 'Começar conversa';
  if (cena === 'erro') return 'Tentar de novo';
  return 'Encerrar conversa';
}

/** Onde cada fala aparece: a sua depois de transcrita; a dele enquanto responde. */
export function falasVisiveis(cena: Cena): { voce: 'cheia' | 'recuada' | null; ze: boolean } {
  if (cena === 'falando' || cena === 'interrompendo') return { voce: 'recuada', ze: true };
  if (cena === 'transcrevendo' || cena === 'esperandoZe' || cena === 'erro') return { voce: 'cheia', ze: false };
  return { voce: null, ze: false };
}

/**
 * Com o texto desligado, a tela só escreve o que pede ação dele, numa linha junto
 * do botão. O resto (em que pé está a conversa) fica com a cor e a forma do visual.
 */
export type EntradaDoAviso = {
  cena: Cena;
  preparacaoFalhou: boolean;
  motivo?: MotivoDeErro;
  /** Falha da voz do Zé (o navegador impediu a reprodução, por exemplo). */
  aviso: string | null;
  wakeLockSuportado: boolean;
  wakeLockFalhou: boolean;
};

export function avisoQuePedeAcao(e: EntradaDoAviso): string | null {
  if (e.preparacaoFalhou) return 'O detector não carregou. Recarregue a página.';
  if (e.cena === 'erro') return e.motivo ? TITULO_DO_ERRO[e.motivo] : 'A conversa parou';
  if (e.cena === 'parado' || e.cena === 'preparando') return null;
  if (e.aviso) return e.aviso;
  if (e.wakeLockFalhou) return 'Não consegui manter a tela acesa.';
  if (!e.wakeLockSuportado) return 'Este navegador não mantém a tela acesa.';
  return null;
}

/**
 * O cartão do pé: o que pede ação dele, com ou sem texto (o título grande saiu da tela). Com
 * "Mostrar texto", o erro ganha uma segunda linha com o que fazer — se ela não repetir o título.
 */
export function avisoDaTela(e: EntradaDoAviso, texto: boolean): { linha: string; detalhe: string | null } | null {
  const linha = avisoQuePedeAcao(e);
  if (!linha) return null;
  if (!texto || e.cena !== 'erro' || e.preparacaoFalhou) return { linha, detalhe: null };
  const detalhe = mensagemDeErro(e.motivo);
  return { linha, detalhe: detalhe.startsWith(linha) ? null : detalhe };
}

/** Sem o "Você disse" na tela, o leitor de tela ainda conta o que foi entendido. */
export function voceDisseParaLeitor(cena: Cena, ultimaTranscricao: string | null): string | null {
  if (cena === 'transcrevendo' || falasVisiveis(cena).voce !== 'cheia' || !ultimaTranscricao) return null;
  return `Você disse: “${ultimaTranscricao}”`;
}
