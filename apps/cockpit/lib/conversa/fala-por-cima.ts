/**
 * A fala por cima, com fone: o Rica começa a falar enquanto o Zé fala. A voz dele pausa
 * (`interrompendo`) até a fala confirmar — guarda a voz até a fala do Rica sair — ou
 * desclassificar (retoma). A fala nunca corta o Zé; cortar é só o toque (`interromper`, em
 * `maquina.ts`). Também mora aqui a chave do fone, que liga e desliga esse caminho.
 */

import { DESLIGA, LIGA, novo, noop, preserva } from './conversa-interna.ts';
import type { ConversaInterna, Resultado } from './conversa-interna.ts';
import type { Efeito } from './tipos.ts';

// Fala por cima detectada enquanto o Zé fala (só com fone): pausa a voz e entra em
// `interrompendo`, aguardando confirmação ou desclassificação.
export function falaIniciou(c: ConversaInterna, agora: number): Resultado {
  // Com o Zé pensando: a fala vira captura normal, que o envio põe na fila.
  if (c.estado === 'esperandoZe') {
    return novo(c, 'ouvindo', [], { capturando: true, daEspera: true, zeDescartado: c.zeDescartado });
  }
  if (c.estado !== 'falando' || c.fone !== true) return noop(c);
  // Preserva os flags de término: ao retomar, a regra "sai com os dois" ainda precisa deles.
  return novo(c, 'interrompendo', [{ tipo: 'pausarVoz' }], {
    zeAcabou: c.zeAcabou,
    vozAcabou: c.vozAcabou,
    interrompeuEm: agora,
  });
}

// Fala curta demais (tosse): desclassifica e retoma a voz de onde parou.
export function falaDescartada(c: ConversaInterna): Resultado {
  if (c.estado !== 'interrompendo') return noop(c);
  return saiDeInterrompendo(c, false);
}

// Fala por cima confirmada: não corta o Zé — a voz fica pausada e guardada enquanto o Rica
// fala, e a fala dele segue normal para a fila do Claude Code. Enviada, a voz retoma de onde
// parou (`captura-do-rica.ts`). Cortar é só o toque (`interromper`).
export function falaConfirmada(c: ConversaInterna): Resultado {
  if (c.estado !== 'interrompendo') return noop(c);
  return novo(c, 'ouvindo', [], { capturando: true, vozGuardada: true, zeAcabou: c.zeAcabou, vozAcabou: c.vozAcabou });
}

// A chave "estou de fone" vale em qualquer estado; com fone, `falando` mantém o detector ligado.
export function fone(c: ConversaInterna, ligado: boolean): Resultado {
  if (ligado) {
    // Ligou o fone no meio da fala do Zé: habilita a fala por cima.
    if (c.estado === 'falando' || c.estado === 'esperandoZe') return preserva(c, [LIGA], { fone: true });
    return preserva(c, [], { fone: true });
  }
  // Desligou o fone no meio de uma interrupção: a fala por cima não vale mais.
  if (c.estado === 'interrompendo') return saiDeInterrompendo(c, true);
  if (c.estado === 'falando' || c.estado === 'esperandoZe') return preserva(c, [DESLIGA], { fone: false });
  return preserva(c, [], { fone: false });
}

// Sai de `interrompendo` de volta à fala do Zé — retomando a voz — ou, se o Zé e a voz
// já terminaram durante a pausa, direto a `ouvindo`. `desligarFone` cobre o "desliguei
// o fone no meio": aí o detector cai junto, voltando ao meio-duplex.
export function saiDeInterrompendo(c: ConversaInterna, desligarFone: boolean): Resultado {
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
