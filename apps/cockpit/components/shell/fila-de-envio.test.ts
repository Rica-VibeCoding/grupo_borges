import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  FILA_VAZIA,
  devolveAoInicio,
  enfileira,
  proximoDaFila,
  reagiuAsFases,
  recadoDaFila,
  retira,
  soltaPausa,
  type EstadoDaFila,
  type FasesDoDespacho,
} from './fila-de-envio.ts';

const ESPERANDO: FasesDoDespacho = { compact: 'compactando', envio: 'ocioso' };
const LIVRE: FasesDoDespacho = { compact: 'ocioso', envio: 'ocioso' };

function comItens(...textos: string[]): EstadoDaFila {
  return textos.reduce((fila, texto, i) => enfileira(fila, { id: `f${i}`, texto }), FILA_VAZIA);
}

describe('as duas metades da régua de pronto', () => {
  it('METADE A — o compact termina e a mensagem sai sozinha', () => {
    const fila = comItens('sobe o build');
    // Enquanto a espera dura, ninguém sai.
    assert.equal(proximoDaFila(fila, ESPERANDO), null);
    // Fim do compact: o resumo chegou, a barra deu o hold e a máquina voltou.
    const depois = reagiuAsFases(fila, LIVRE);
    assert.equal(proximoDaFila(depois, LIVRE)?.texto, 'sobe o build');
  });

  it('METADE B — NADA sai durante o compact, por nenhuma das fases dele', () => {
    const fila = comItens('sobe o build', 'e o segundo');
    for (const compact of ['compactando', 'concluindo'] as const) {
      const fases = { compact, envio: 'ocioso' } as const;
      assert.equal(
        proximoDaFila(reagiuAsFases(fila, fases), fases),
        null,
        `${compact} soltou texto no meio do compact — o resumo sai cortado`,
      );
    }
  });
});

describe('a trava cai por três caminhos e um deles não pode despachar', () => {
  it('`concluindo` → `ocioso` é o caso feliz: despacha', () => {
    const fila = reagiuAsFases(comItens('vai'), { compact: 'concluindo', envio: 'ocioso' });
    assert.equal(proximoDaFila(reagiuAsFases(fila, LIVRE), LIVRE)?.texto, 'vai');
  });

  it('compact cancelado devolve a fila: ele desistiu, a mensagem dele vale', () => {
    // `cancelar()` vai direto de `compactando` para `ocioso`, sem `concluindo`.
    const fila = reagiuAsFases(comItens('vai'), LIVRE);
    assert.equal(proximoDaFila(fila, LIVRE)?.texto, 'vai');
  });

  it('`sem-retorno` PAUSA — ali o compact pode estar vivo e mudo', () => {
    const fila = reagiuAsFases(comItens('vai'), { compact: 'sem-retorno', envio: 'ocioso' });
    assert.equal(fila.pausa, 'sem-retorno');
    // A fase `sem-retorno` já destrava o composer (`travaCompact` não a inclui),
    // então sem a pausa a fila despacharia por cima de um compact em andamento.
    assert.equal(proximoDaFila(fila, { compact: 'sem-retorno', envio: 'ocioso' }), null);
  });

  it('dispensar o aviso de "sem retorno" NÃO é permissão de envio', () => {
    // O × da BarraCompact chama `cancelar()`, e a fase volta a `ocioso`. Se a
    // fila lesse só a fase, ela despacharia por um gesto que só fechou um aviso.
    const pausada = reagiuAsFases(comItens('vai'), { compact: 'sem-retorno', envio: 'ocioso' });
    const depoisDoDismiss = reagiuAsFases(pausada, LIVRE);
    assert.equal(depoisDoDismiss.pausa, 'sem-retorno');
    assert.equal(proximoDaFila(depoisDoDismiss, LIVRE), null);
  });

  it('o resumo atrasado chegando solta a pausa do "sem retorno"', () => {
    // `concluir()` acolhe o resumo mesmo vindo de `sem-retorno` — ver
    // `lib/compact.ts`. Ali o compact terminou de verdade.
    const pausada = reagiuAsFases(comItens('vai'), { compact: 'sem-retorno', envio: 'ocioso' });
    const solta = reagiuAsFases(pausada, { compact: 'concluindo', envio: 'ocioso' });
    assert.equal(solta.pausa, null);
    assert.equal(proximoDaFila(reagiuAsFases(solta, LIVRE), LIVRE)?.texto, 'vai');
  });

  it('só o toque do Rica solta a pausa que a máquina não solta', () => {
    const pausada = reagiuAsFases(comItens('vai'), { compact: 'sem-retorno', envio: 'ocioso' });
    assert.equal(proximoDaFila(soltaPausa(pausada), LIVRE)?.texto, 'vai');
  });
});

describe('despacha em conclusão, PAUSA em falha', () => {
  it('envio que não confirma segura a fila — drenar por cima come o pendurado', () => {
    for (const envio of ['falhou', 'nao-confirmado'] as const) {
      const fila = reagiuAsFases(comItens('um', 'dois'), { compact: 'ocioso', envio });
      assert.equal(fila.pausa, 'envio-falhou', `${envio} deixou a fila andar por cima`);
      assert.equal(proximoDaFila(fila, LIVRE), null);
    }
  });

  it('o eco voltando solta a pausa e a drenagem continua', () => {
    const parada = reagiuAsFases(comItens('um', 'dois'), {
      compact: 'ocioso',
      envio: 'falhou',
    });
    const retomada = reagiuAsFases(parada, { compact: 'ocioso', envio: 'confirmado' });
    assert.equal(retomada.pausa, null);
    assert.equal(proximoDaFila(retomada, { compact: 'ocioso', envio: 'confirmado' })?.texto, 'um');
  });

  it('o despacho recusado devolve o item ao INÍCIO, nunca ao fim', () => {
    // A ordem em que ele escreveu é dado. Reenfileirar no fim entregaria as
    // mensagens fora de ordem ao agente, que é pior que não entregar.
    const fila = comItens('dois', 'três');
    const devolvida = devolveAoInicio(fila, { id: 'f0', texto: 'um' });
    assert.deepEqual(
      devolvida.itens.map((i) => i.texto),
      ['um', 'dois', 'três'],
    );
    assert.equal(devolvida.pausa, 'envio-falhou');
  });
});

describe('fila de N, despacho serializado', () => {
  it('sai um por vez: o segundo espera o eco do primeiro', () => {
    const fila = comItens('um', 'dois', 'três');
    assert.equal(proximoDaFila(fila, LIVRE)?.texto, 'um');
    // Com a anterior em voo, a porta recusaria — e a fila também segura, senão
    // o despacho automático bateria na porta e voltaria como aviso de recusa.
    for (const envio of ['enviando', 'aceito'] as const) {
      assert.equal(proximoDaFila(fila, { compact: 'ocioso', envio }), null);
    }
  });

  it('a fila preserva a ordem em que ele escreveu', () => {
    const fila = comItens('um', 'dois', 'três');
    assert.deepEqual(
      fila.itens.map((i) => i.texto),
      ['um', 'dois', 'três'],
    );
  });
});

describe('nada que saia da fila evapora', () => {
  it('retirar devolve o item para quem o pediu de volta', () => {
    const fila = comItens('um', 'dois');
    const { estado, item } = retira(fila, 'f0');
    assert.equal(item?.texto, 'um');
    assert.deepEqual(
      estado.itens.map((i) => i.texto),
      ['dois'],
    );
  });

  it('retirar um id que não existe não mexe na fila nem inventa texto', () => {
    const fila = comItens('um');
    const { estado, item } = retira(fila, 'fantasma');
    assert.equal(item, null);
    assert.equal(estado, fila, 'objeto novo por nada faz o efeito girar em falso');
  });
});

describe('a fila fala de si', () => {
  it('cada estado tem a sua frase, e a vazia não fala', () => {
    assert.equal(recadoDaFila(FILA_VAZIA), '');
    assert.match(recadoDaFila(comItens('um')), /na fila/);
    const semSinal = reagiuAsFases(comItens('um'), { compact: 'sem-retorno', envio: 'ocioso' });
    assert.match(recadoDaFila(semSinal), /não deu sinal/);
    const falhou = reagiuAsFases(comItens('um'), { compact: 'ocioso', envio: 'falhou' });
    assert.match(recadoDaFila(falhou), /não confirmou/);
  });
});

describe('o efeito não pode girar em falso', () => {
  it('sem novidade, `reagiuAsFases` devolve o MESMO objeto', () => {
    // O componente passa o retorno direto pro `setState`: identidade estável é
    // o que faz o React desistir do re-render em vez de refazer o ciclo.
    const fila = comItens('um');
    assert.equal(reagiuAsFases(fila, ESPERANDO), fila);
    assert.equal(reagiuAsFases(FILA_VAZIA, LIVRE), FILA_VAZIA);
  });

  it('a pausa morre com a fila — ela é estado da espera, não do agente', () => {
    // Pausa sobrevivendo à fila vazia travaria a fila SEGUINTE antes de ela
    // existir, e ninguém entenderia por quê.
    const pausada = reagiuAsFases(comItens('um'), { compact: 'sem-retorno', envio: 'ocioso' });
    const vazia = retira(pausada, 'f0').estado;
    assert.equal(reagiuAsFases(vazia, LIVRE).pausa, null);
  });
});
