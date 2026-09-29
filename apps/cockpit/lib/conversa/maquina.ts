/**
 * Máquina de estados do modo conversa — PURA.
 *
 * Sem timer, sem fetch, sem DOM: o relógio entra por `agora` (ms, `performance.now()`
 * na tela, número fixo no teste). O contrato está em `tipos.ts`; a tela executa os
 * efeitos que a máquina decide.
 *
 * Meio-duplex: sem fone, o detector só fica ligado em `ouvindo` — desligado inclusive
 * em `esperandoZe`, onde a frase-ponte toca e o Chrome não cancela o eco da própria
 * página (pesquisa §3). Fase 2, com fone: ouve também em `falando`, e a fala detectada
 * pausa a voz do Zé (`interrompendo`) até confirmar (descarta) ou desclassificar
 * (retoma). Fase 3: parar com o turno em voo pede o freio no servidor (`frearZe`).
 */

import { TEMPOS } from './tipos.ts';
import type { Avanca, Conversa, Efeito, Estado, Evento, MotivoDeErro } from './tipos.ts';

type ConversaInterna = Conversa & {
  fone?: boolean; // chave "estou de fone" — a única memória que atravessa estados
  esperandoDesde?: number; // `agora` do `enviou`; base do relógio da espera
  ponteDita?: boolean; // `falarPonte` já saiu neste turno
  avisoDito?: boolean; // `avisarDemora` já saiu neste turno
  zeAcabou?: boolean; // `zeTerminou` já veio neste turno de `falando`/`interrompendo`
  vozAcabou?: boolean; // `vozTerminou` já veio neste turno de `falando`/`interrompendo`
  interrompeuEm?: number; // `agora` do `falaIniciou`; base do relógio de desclassificação
  zeDescartado?: boolean; // turno do Zé descartado (fala por cima ou toque que parou); residual é ignorado
};

/** O turno em voo foi descartado: o texto que ainda vier dele não fala, e ele não é ocupação. */
export const turnoDescartado = (c: Conversa): boolean => (c as ConversaInterna).zeDescartado === true;

type Resultado = { conversa: Conversa; efeitos: Efeito[] };

const LIGA: Efeito = { tipo: 'ligarDetector' };
const DESLIGA: Efeito = { tipo: 'desligarDetector' };

// Estado novo, memória zerada — só o que vem em `extra` sobrevive, e sempre a chave
// `fone`, que vale em qualquer estado, inclusive `parado`.
const novo = (
  c: ConversaInterna,
  estado: Estado,
  efeitos: Efeito[] = [],
  extra: Partial<ConversaInterna> = {},
): Resultado => ({ conversa: { estado, fone: c.fone, ...extra }, efeitos });

// Preserva a memória (mesmo estado) e aplica `extra`.
const preserva = (
  c: ConversaInterna,
  efeitos: Efeito[] = [],
  extra: Partial<ConversaInterna> = {},
): Resultado => ({ conversa: { ...c, ...extra }, efeitos });

const noop = (c: ConversaInterna): Resultado => ({ conversa: c, efeitos: [] });

// O detector está ligado? Sem fone, só em `ouvindo`; com fone, também em `falando`
// (capturar fala por cima) e em `interrompendo` (a fala já começou).
const detectorLigado = (c: ConversaInterna): boolean =>
  c.estado === 'ouvindo' ||
  c.estado === 'interrompendo' ||
  (c.estado === 'falando' && c.fone === true);

export const inicial = (): Conversa => ({ estado: 'parado' });

export const avanca: Avanca = (conversa, evento, agora) => {
  const c = conversa as ConversaInterna;
  switch (evento.tipo) {
    case 'comecar':
    case 'retomar': // fase 4: o toque pós-recarga com o turno do Zé aberto volta a esperar por ele
      return comecar(c, evento.tipo === 'retomar' ? agora : undefined);
    case 'parar':
      return parar(c);
    case 'tique':
      return tique(c, agora);
    case 'falaIniciou':
      return falaIniciou(c, agora);
    case 'falaDescartada':
      return falaDescartada(c);
    case 'falaConfirmada':
      return falaConfirmada(c);
    case 'fone':
      return fone(c, evento.ligado);
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
    case 'pedidoEntrou':
      return pedidoEntrou(c);
    case 'vozTerminou':
      return vozTerminou(c);
    case 'capturaCaiu':
      return capturaCaiu(c);
    case 'falhou':
      return falhou(c, evento.motivo);
  }
};

// O toque que destrava áudio, microfone e Wake Lock. Idempotente: repetido fora de
// `parado`/`erro` não faz nada (a fase 0 mediu: 4 toques = 4 detectores). A marca de
// descarte atravessa: o turno freado ainda pode mandar texto depois do recomeço.
function comecar(c: ConversaInterna, retomaEm?: number): Resultado {
  if (c.estado !== 'parado' && c.estado !== 'erro') return noop(c);
  if (retomaEm !== undefined) return novo(c, 'esperandoZe', [], { esperandoDesde: retomaEm }); // surdo, relógio zerado
  return novo(c, 'ouvindo', [LIGA], c.zeDescartado ? { zeDescartado: true } : {});
}

// Com o turno do Zé em voo — esperando, ou falando antes do fim do stream — freia no
// servidor e marca o descarte. Turno já descartado não freia de novo.
function parar(c: ConversaInterna): Resultado {
  if (c.estado === 'parado') return noop(c);
  const efeitos: Efeito[] = detectorLigado(c) ? [DESLIGA] : [];
  const falandoAinda = (c.estado === 'falando' || c.estado === 'interrompendo') && !c.zeAcabou;
  const emVoo = c.estado === 'esperandoZe' || falandoAinda;
  if (emVoo && !c.zeDescartado) efeitos.push({ tipo: 'frearZe', antesDaResposta: c.estado === 'esperandoZe' });
  return novo(c, 'parado', efeitos, emVoo || c.zeDescartado ? { zeDescartado: true } : {});
}

// Relógio da espera e da desclassificação, movido pelo tique da tela (~250 ms).
function tique(c: ConversaInterna, agora: number): Resultado {
  if (c.estado === 'esperandoZe') {
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
  if (c.estado === 'interrompendo') {
    // Rede de segurança para o callback perdido do Silero; quem desclassifica é o `falaDescartada`.
    if (agora - (c.interrompeuEm ?? agora) >= TEMPOS.socorroFalaPorCima) {
      return saiDeInterrompendo(c, false);
    }
  }
  return noop(c);
}

function falaTerminou(c: ConversaInterna, audio: Float32Array): Resultado {
  if (c.estado !== 'ouvindo') return noop(c);
  return novo(c, 'transcrevendo', [DESLIGA, { tipo: 'transcrever', audio }], {
    zeDescartado: c.zeDescartado,
  });
}

function transcreveu(c: ConversaInterna, texto: string): Resultado {
  if (c.estado !== 'transcrevendo') return noop(c);
  if (texto.trim() === '') {
    // transcricaoVazia: volta a ouvir sem incomodar — não é erro, só não havia o que enviar.
    return novo(c, 'ouvindo', [LIGA], { zeDescartado: c.zeDescartado });
  }
  // Envia e toca o tique. `transcrevendo` cobre o envio; a espera começa no `enviou`.
  return preserva(c, [{ tipo: 'enviar', texto }, { tipo: 'tocarTique' }]);
}

function enviou(c: ConversaInterna, agora: number): Resultado {
  if (c.estado !== 'transcrevendo') return noop(c);
  return novo(c, 'esperandoZe', [], { esperandoDesde: agora, zeDescartado: c.zeDescartado });
}

function textoDoZe(c: ConversaInterna, texto: string): Resultado {
  if (c.zeDescartado) return noop(c); // turno descartado: texto residual é lixo
  switch (c.estado) {
    case 'falando':
    case 'interrompendo':
      // Voz nova na fila: o término anterior não vale mais. Em `interrompendo` a tela só
      // enfileira; confirmar descarta tudo, desclassificar toca o que ficou na fila.
      return preserva(c, [{ tipo: 'falar', texto }], { vozAcabou: false });
    case 'esperandoZe':
    case 'ouvindo':
    case 'transcrevendo':
      // Entra em `falando`; com fone, o detector segue ligado para a fala por cima. Em
      // `ouvindo`/`transcrevendo` é defensivo: nunca perder a fala dele.
      return novo(c, 'falando', [c.fone ? LIGA : DESLIGA, { tipo: 'falar', texto }]);
    default:
      return noop(c); // parado, erro
  }
}

function zeTerminou(c: ConversaInterna): Resultado {
  // Turno descartado: este é o fim do velho. Só limpa a marca; o que vier é o turno novo.
  if (c.zeDescartado) return preserva(c, [], { zeDescartado: false });
  if (c.estado === 'falando') {
    // Sai de `falando` só quando a voz E o stream acabarem — um pode vir antes do outro.
    if (c.vozAcabou) return novo(c, 'ouvindo', [LIGA]);
    return preserva(c, [], { zeAcabou: true });
  }
  if (c.estado === 'interrompendo') {
    // A pausa não é saída: só marca, para a regra "sai com os dois" valer depois do retomar.
    return preserva(c, [], { zeAcabou: true });
  }
  if (c.estado === 'esperandoZe') {
    // O Zé não produziu texto nenhum: volta a ouvir.
    return novo(c, 'ouvindo', [LIGA]);
  }
  return noop(c);
}

// A pergunta que esperava na fila do Claude Code entrou no turno descartado, emendada nele
// sem fim entre os dois: o que o Zé escrever daqui em diante já a responde — volta a falar.
function pedidoEntrou(c: ConversaInterna): Resultado {
  return c.zeDescartado ? preserva(c, [], { zeDescartado: false }) : noop(c);
}

function vozTerminou(c: ConversaInterna): Resultado {
  if (c.estado === 'falando') {
    if (c.zeAcabou) return novo(c, 'ouvindo', [LIGA]);
    return preserva(c, [], { vozAcabou: true });
  }
  if (c.estado === 'interrompendo') {
    return preserva(c, [], { vozAcabou: true });
  }
  return noop(c);
}

// Fala por cima detectada enquanto o Zé fala (só com fone): pausa a voz e entra em
// `interrompendo`, aguardando confirmação ou desclassificação.
function falaIniciou(c: ConversaInterna, agora: number): Resultado {
  if (c.estado !== 'falando' || c.fone !== true) return noop(c);
  // Preserva os flags de término: ao retomar, a regra "sai com os dois" ainda precisa deles.
  return novo(c, 'interrompendo', [{ tipo: 'pausarVoz' }], {
    zeAcabou: c.zeAcabou,
    vozAcabou: c.vozAcabou,
    interrompeuEm: agora,
  });
}

// Fala curta demais (tosse): desclassifica e retoma a voz de onde parou.
function falaDescartada(c: ConversaInterna): Resultado {
  if (c.estado !== 'interrompendo') return noop(c);
  return saiDeInterrompendo(c, false);
}

// Fala por cima confirmada: joga a fila do Zé fora e passa a ouvir o usuário, que
// segue como fala normal (`falaTerminou` depois leva a `transcrevendo` como sempre).
function falaConfirmada(c: ConversaInterna): Resultado {
  if (c.estado !== 'interrompendo') return noop(c);
  // Stream do Zé ainda em voo: o turno é descartado e o texto residual não fala por cima.
  const extra: Partial<ConversaInterna> = c.zeAcabou ? {} : { zeDescartado: true };
  return novo(c, 'ouvindo', [{ tipo: 'descartarVoz' }], extra);
}

// A chave "estou de fone" vale em qualquer estado; com fone, `falando` mantém o detector ligado.
function fone(c: ConversaInterna, ligado: boolean): Resultado {
  if (ligado) {
    // Ligou o fone no meio da fala do Zé: habilita a fala por cima.
    if (c.estado === 'falando') return preserva(c, [LIGA], { fone: true });
    return preserva(c, [], { fone: true });
  }
  // Desligou o fone no meio de uma interrupção: a fala por cima não vale mais.
  if (c.estado === 'interrompendo') return saiDeInterrompendo(c, true);
  if (c.estado === 'falando') return preserva(c, [DESLIGA], { fone: false });
  return preserva(c, [], { fone: false });
}

// Sai de `interrompendo` de volta à fala do Zé — retomando a voz — ou, se o Zé e a voz
// já terminaram durante a pausa, direto a `ouvindo`. `desligarFone` cobre o "desliguei
// o fone no meio": aí o detector cai junto, voltando ao meio-duplex.
function saiDeInterrompendo(c: ConversaInterna, desligarFone: boolean): Resultado {
  const extra: Partial<ConversaInterna> = {
    zeAcabou: c.zeAcabou,
    vozAcabou: c.vozAcabou,
    ...(desligarFone ? { fone: false } : {}),
  };
  // A pausa é sempre desfeita — `interrompendo` começa com `pausarVoz`.
  const retoma: Efeito = { tipo: 'retomarVoz' };
  if (c.zeAcabou && c.vozAcabou) {
    // Zé e voz já terminaram: não há o que retomar, vai direto a ouvir.
    return novo(c, 'ouvindo', [retoma, LIGA], extra);
  }
  // Volta a falar. Sem fone (desligou no meio), o detector cai junto.
  return novo(c, 'falando', desligarFone ? [retoma, DESLIGA] : [retoma], extra);
}

function capturaCaiu(c: ConversaInterna): Resultado {
  if (c.estado === 'parado' || c.estado === 'erro') return noop(c);
  const efeitos: Efeito[] = [DESLIGA, { tipo: 'avisarErro', motivo: 'capturaCaiu' }];
  // Saindo de `interrompendo`, o reprodutor ficou pausado: descarta para liberar o áudio.
  if (c.estado === 'interrompendo') efeitos.unshift({ tipo: 'descartarVoz' });
  return novo(c, 'erro', efeitos, { motivo: 'capturaCaiu' });
}

function falhou(c: ConversaInterna, motivo: MotivoDeErro): Resultado {
  if (c.estado === 'parado') return noop(c);
  if (motivo === 'transcricaoVazia' && c.estado === 'transcrevendo') {
    return novo(c, 'ouvindo', [LIGA], { zeDescartado: c.zeDescartado });
  }
  const efeitos: Efeito[] = [DESLIGA, { tipo: 'avisarErro', motivo }];
  if (c.estado === 'interrompendo') efeitos.unshift({ tipo: 'descartarVoz' });
  return novo(c, 'erro', efeitos, { motivo });
}
