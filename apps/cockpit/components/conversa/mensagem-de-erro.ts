import type { Conversa } from '@/lib/conversa/tipos';

export function mensagemDeErro(motivo: Conversa['motivo']): string {
  switch (motivo) {
    case 'microfoneNegado':
      return 'O microfone não foi liberado. Autorize o acesso e tente novamente.';
    case 'capturaCaiu':
      return 'O microfone parou. Toque para retomar a conversa.';
    case 'transcricaoFalhou':
      return 'Não consegui entender o áudio. Toque para tentar novamente.';
    case 'transcricaoVazia':
      return 'Não ouvi uma frase completa.';
    case 'envioFalhou':
      return 'A mensagem não chegou ao agente. Toque para tentar novamente.';
    case 'escutaMuda':
      return 'O microfone ficou mudo. Toque para voltar a ouvir.';
    case 'agenteOcupado':
      return 'O agente já está atendendo outro turno. Tente novamente quando ele terminar.';
    default:
      return 'A conversa foi interrompida.';
  }
}

