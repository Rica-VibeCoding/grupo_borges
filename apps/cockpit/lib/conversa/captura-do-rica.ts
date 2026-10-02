import { DESLIGA, LIGA, type ConversaInterna } from './conversa-interna.ts';
import type { Efeito, Evento } from './tipos.ts';

type Captura = ConversaInterna & { segurando?: boolean };
type Resultado = { conversa: Captura; efeitos: Efeito[] };

// A fala começada com o Zé pensando não saiu (tosse, mudo): volta a esperar por ele — ou a ouvir,
// se ele acabou no meio. Na espera com fone, o detector segue ligado; sem fone (a uma fala), fecha.
function voltaAEspera(c: Captura): Resultado {
  const estado = c.zeAcabou ? 'ouvindo' : 'esperandoZe';
  const efeitos = estado === 'esperandoZe' && !c.fone ? [DESLIGA] : [];
  return { conversa: { estado, fone: c.fone, zeDescartado: c.zeDescartado }, efeitos };
}

function libera(c: Captura): Resultado {
  const terminou = c.vozAcabou && c.zeAcabou;
  return {
    conversa: { ...c, estado: terminou ? 'ouvindo' : 'falando', capturando: false, vozGuardada: false },
    efeitos: terminou || c.fone
      ? [{ tipo: 'retomarVoz' }, LIGA]
      : [DESLIGA, { tipo: 'retomarVoz' }],
  };
}

export function duranteCaptura(c: Captura, evento: Evento): Resultado | null {
  if (evento.tipo === 'microfoneMudo' && (c.estado === 'ouvindo' || c.estado === 'transcrevendo')) {
    if (c.enviando) return { conversa: c, efeitos: [] };
    const limpa = { ...c, capturando: false, segurando: false };
    if (c.vozGuardada) return libera(limpa);
    return c.daEspera ? voltaAEspera(limpa) : { conversa: { ...limpa, estado: 'ouvindo' }, efeitos: [] };
  }
  if (evento.tipo === 'segurou') {
    if (c.estado !== 'ouvindo') return { conversa: c, efeitos: [] };
    const conversa = { ...c, segurando: evento.ligado };
    return !evento.ligado && !c.capturando && c.vozGuardada
      ? libera(conversa)
      : { conversa, efeitos: [] };
  }
  if (evento.tipo === 'falaIniciou' && c.estado === 'ouvindo') {
    return { conversa: { ...c, capturando: true }, efeitos: [] };
  }
  if (evento.tipo === 'falaDescartada' && c.estado === 'ouvindo') {
    if (c.vozGuardada && !c.segurando) return libera(c);
    // A uma fala segue aberta depois da tosse: o microfone só fecha com a fala dita (ou o toque).
    return c.daEspera && !c.segurando && !c.umaFala ? voltaAEspera(c) : { conversa: { ...c, capturando: false }, efeitos: [] };
  }
  if (evento.tipo === 'textoDoZe' && !c.zeDescartado &&
      ((c.estado === 'ouvindo' && (c.capturando || c.segurando)) || c.estado === 'transcrevendo')) {
    return {
      conversa: { ...c, vozGuardada: true, vozAcabou: false },
      efeitos: [{ tipo: 'pausarVoz' }, { tipo: 'falar', texto: evento.texto }],
    };
  }
  if (!c.vozGuardada) return null;
  if (evento.tipo === 'zeTerminou') return { conversa: { ...c, zeAcabou: true }, efeitos: [] };
  if (evento.tipo === 'vozTerminou') return { conversa: { ...c, vozAcabou: true }, efeitos: [] };
  if (evento.tipo === 'transcreveu' && c.estado === 'transcrevendo' && evento.texto.trim() === '') return libera(c);
  if (evento.tipo === 'falhou' && evento.motivo === 'transcricaoVazia' && c.estado === 'transcrevendo') return libera(c);
  if (evento.tipo === 'capturaCaiu' || evento.tipo === 'falhou') {
    const motivo = evento.tipo === 'capturaCaiu' ? 'capturaCaiu' : evento.motivo;
    return {
      conversa: { estado: 'erro', fone: c.fone, motivo },
      efeitos: [{ tipo: 'descartarVoz' }, DESLIGA, { tipo: 'avisarErro', motivo }],
    };
  }
  if (evento.tipo === 'enviou' && c.estado === 'transcrevendo') {
    const estado = c.vozAcabou ? 'esperandoZe' : 'falando';
    return {
      conversa: { estado, fone: c.fone },
      // Esperando ou falando, só com fone: o detector desligado no fim da fala volta.
      efeitos: c.fone ? [{ tipo: 'retomarVoz' }, LIGA] : [{ tipo: 'retomarVoz' }],
    };
  }
  return null;
}

export function encerraCaptura(c: Captura, audio: Float32Array): Resultado {
  if (c.estado !== 'ouvindo') return { conversa: c, efeitos: [] };
  return {
    conversa: {
      estado: 'transcrevendo', fone: c.fone, zeDescartado: c.zeDescartado,
      ...(c.vozGuardada ? { vozGuardada: true, zeAcabou: c.zeAcabou, vozAcabou: c.vozAcabou } : {}),
      ...(c.daEspera ? { daEspera: true, zeAcabou: c.zeAcabou } : {}),
    },
    efeitos: [DESLIGA, { tipo: 'transcrever', audio }],
  };
}
