/**
 * Máquina de estados do modo conversa — PURA.
 *
 * Sem timer, sem fetch, sem DOM: o relógio entra por `agora` (ms, `performance.now()`
 * na tela, número fixo no teste). O contrato está em `tipos.ts`; a tela executa os
 * efeitos que a máquina decide.
 *
 * Meio-duplex: o detector só fica ligado em `ouvindo`. Em todos os outros estados ele
 * está desligado — e é assim de propósito, não só em `falando` como o contrato pede:
 * a frase-ponte e o aviso de demora tocam em `esperandoZe`, e um detector ouvindo
 * enquanto a própria página toca áudio captura eco (o Chrome não cancela o áudio da
 * página, pesquisa §3). Desligar já no `falaTerminou` evita esse eco de graça.
 */

import { TEMPOS } from './tipos.ts';
import type { Avanca, Conversa, Efeito, Estado, Evento, MotivoDeErro } from './tipos.ts';

type ConversaInterna = Conversa & {
  esperandoDesde?: number; // `agora` do `enviou`; base do relógio da espera
  ponteDita?: boolean; // `falarPonte` já saiu neste turno
  avisoDito?: boolean; // `avisarDemora` já saiu neste turno
  zeAcabou?: boolean; // `zeTerminou` já veio neste turno de `falando`
  vozAcabou?: boolean; // `vozTerminou` já veio neste turno de `falando`
};

type Resultado = { conversa: Conversa; efeitos: Efeito[] };

const LIGA: Efeito = { tipo: 'ligarDetector' };
const DESLIGA: Efeito = { tipo: 'desligarDetector' };

// Estado novo, memória zerada — só o que vem em `extra` sobrevive.
const novo = (
  estado: Estado,
  efeitos: Efeito[] = [],
  extra: Partial<ConversaInterna> = {},
): Resultado => ({ conversa: { estado, ...extra }, efeitos });

// Preserva a memória (mesmo estado) e aplica `extra`.
const preserva = (
  c: ConversaInterna,
  efeitos: Efeito[] = [],
  extra: Partial<ConversaInterna> = {},
): Resultado => ({ conversa: { ...c, ...extra }, efeitos });

const noop = (c: ConversaInterna): Resultado => ({ conversa: c, efeitos: [] });

export const inicial = (): Conversa => ({ estado: 'parado' });

export const avanca: Avanca = (conversa, evento, agora) => {
  const c = conversa as ConversaInterna;
  switch (evento.tipo) {
    case 'comecar':
      return comecar(c);
    case 'parar':
      return parar(c);
    case 'tique':
      return tique(c, agora);
    case 'falaIniciou':
    case 'falaDescartada':
      // Só importam em `ouvindo`, e lá não mudam nada: quem desenha o "ouvindo você"
      // é a tela, que disparou o evento e já sabe.
      return noop(c);
    case 'falaTerminou':
      return falaTerminou(c, evento.audio);
    case 'transcreveu':
      return transcreveu(c, evento.texto);
    case 'enviou':
      return enviou(c, agora);
    case 'textoDoZe':
      return textoDoZe(c, evento.texto);
    case 'zeTerminou':
      return zeTerminou(c);
    case 'vozTerminou':
      return vozTerminou(c);
    case 'capturaCaiu':
      return capturaCaiu(c);
    case 'falhou':
      return falhou(c, evento.motivo);
  }
};

// O toque que destrava áudio, microfone e Wake Lock. Idempotente: repetido fora de
// `parado`/`erro` não faz nada (a fase 0 mediu: 4 toques = 4 detectores).
function comecar(c: ConversaInterna): Resultado {
  if (c.estado === 'parado' || c.estado === 'erro') {
    return novo('ouvindo', [LIGA]);
  }
  return noop(c);
}

function parar(c: ConversaInterna): Resultado {
  if (c.estado === 'parado') return noop(c);
  // Só `ouvindo` está com o detector ligado; nos demais estados ele já caiu.
  if (c.estado === 'ouvindo') return novo('parado', [DESLIGA]);
  return novo('parado');
}

// Relógio da espera: só roda em `esperandoZe`, movido pelo tique da tela (~250 ms).
function tique(c: ConversaInterna, agora: number): Resultado {
  if (c.estado !== 'esperandoZe') return noop(c);
  const desde = c.esperandoDesde ?? agora;
  const efeitos: Efeito[] = [];
  const extra: Partial<ConversaInterna> = {};
  if (!c.ponteDita && agora - desde >= TEMPOS.ponte) {
    efeitos.push({ tipo: 'falarPonte' });
    extra.ponteDita = true;
  }
  if (!c.avisoDito && agora - desde >= TEMPOS.avisoDemora) {
    efeitos.push({ tipo: 'avisarDemora' });
    extra.avisoDito = true;
  }
  return preserva(c, efeitos, extra);
}

function falaTerminou(c: ConversaInterna, audio: Float32Array): Resultado {
  if (c.estado !== 'ouvindo') return noop(c);
  return novo('transcrevendo', [DESLIGA, { tipo: 'transcrever', audio }]);
}

function transcreveu(c: ConversaInterna, texto: string): Resultado {
  if (c.estado !== 'transcrevendo') return noop(c);
  if (texto.trim() === '') {
    // transcricaoVazia: volta a ouvir sem incomodar — não é erro, só não havia o que enviar.
    return novo('ouvindo', [LIGA]);
  }
  // Envia e toca o tique na hora. `transcrevendo` também cobre o envio (o contrato
  // não tem estado `enviando`); a espera só começa quando `enviou` confirmar.
  return preserva(c, [{ tipo: 'enviar', texto }, { tipo: 'tocarTique' }]);
}

function enviou(c: ConversaInterna, agora: number): Resultado {
  if (c.estado !== 'transcrevendo') return noop(c);
  return novo('esperandoZe', [], { esperandoDesde: agora });
}

function textoDoZe(c: ConversaInterna, texto: string): Resultado {
  switch (c.estado) {
    case 'falando':
      // Voz nova na fila: o término anterior não vale mais — zera vozAcabou, senão
      // o `zeTerminou` seguinte religaria o detector com a voz ainda tocando.
      return preserva(c, [{ tipo: 'falar', texto }], { vozAcabou: false });
    case 'esperandoZe':
    case 'ouvindo':
    case 'transcrevendo':
      // Entra em `falando`: desliga o detector e fala. Nos casos `ouvindo`/`transcrevendo`
      // é defensivo (o Zé respondeu por fora do fluxo normal — nunca perder a fala dele).
      return novo('falando', [DESLIGA, { tipo: 'falar', texto }]);
    default:
      return noop(c); // parado, erro
  }
}

function zeTerminou(c: ConversaInterna): Resultado {
  if (c.estado === 'falando') {
    // Sai de `falando` só quando a voz E o stream acabarem — um pode vir antes do outro.
    if (c.vozAcabou) return novo('ouvindo', [LIGA]);
    return preserva(c, [], { zeAcabou: true });
  }
  if (c.estado === 'esperandoZe') {
    // O Zé não produziu texto nenhum: volta a ouvir.
    return novo('ouvindo', [LIGA]);
  }
  return noop(c);
}

function vozTerminou(c: ConversaInterna): Resultado {
  if (c.estado !== 'falando') return noop(c);
  if (c.zeAcabou) return novo('ouvindo', [LIGA]);
  return preserva(c, [], { vozAcabou: true });
}

function capturaCaiu(c: ConversaInterna): Resultado {
  if (c.estado === 'parado' || c.estado === 'erro') return noop(c);
  return novo('erro', [DESLIGA, { tipo: 'avisarErro', motivo: 'capturaCaiu' }], {
    motivo: 'capturaCaiu',
  });
}

function falhou(c: ConversaInterna, motivo: MotivoDeErro): Resultado {
  if (c.estado === 'parado') return noop(c);
  if (motivo === 'transcricaoVazia' && c.estado === 'transcrevendo') {
    return novo('ouvindo', [LIGA]);
  }
  return novo('erro', [DESLIGA, { tipo: 'avisarErro', motivo }], { motivo });
}
