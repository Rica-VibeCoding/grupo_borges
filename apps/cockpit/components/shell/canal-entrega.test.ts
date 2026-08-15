import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { anuncioPara, frasePara, leCanalBloqueado } from './canal-entrega.ts';

/** O corpo real do `GET /api/agents/{slug}/painel`, campo por campo como o
 *  `tmux_driver.get_delivery_channel_state` monta. */
function painelBloqueado(extra: Record<string, unknown> = {}) {
  return {
    slug: 'canario',
    canal_entrega: {
      estado: 'bloqueado',
      entregando: false,
      outcome: 'refused',
      safe_to_resend: true,
      motivo: 'input_ocupado_ou_travado',
      mensagem: 'O campo de mensagem do agente está ocupado ou travado.',
      recusas_consecutivas: 2,
      bloqueado_desde: 1785955000,
      bloqueado_ha_segundos: 47,
      ultima_tentativa_em: 1785955040,
      acao_recomendada: "Use 'Destravar agente' antes de enviar novamente.",
      ...extra,
    },
  };
}

describe('leCanalBloqueado — só um bloqueio de verdade troca o que está na tela', () => {
  it('lê o bloqueio com motivo, contador e duração', () => {
    const canal = leCanalBloqueado(painelBloqueado());
    assert.deepEqual(canal, {
      mensagem: 'O campo de mensagem do agente está ocupado ou travado.',
      recusasConsecutivas: 2,
      bloqueadoHaSegundos: 47,
    });
  });

  it('devolve null nos dois estados que NÃO são bloqueio', () => {
    for (const estado of ['entregando', 'sem_dados']) {
      assert.equal(leCanalBloqueado(painelBloqueado({ estado })), null, estado);
    }
  });

  it('não afirma que o texto ficou de fora quando o desfecho é incerto', () => {
    assert.equal(
      leCanalBloqueado(
        painelBloqueado({ outcome: 'uncertain', safe_to_resend: false }),
      ),
      null,
    );
  });

  it('painel antigo sem prova de reenvio seguro mantém a dúvida honesta', () => {
    assert.equal(
      leCanalBloqueado({
        canal_entrega: {
          ...painelBloqueado().canal_entrega,
          outcome: undefined,
          safe_to_resend: undefined,
        },
      }),
      null,
    );
  });

  it('devolve null quando o campo nem existe — painel antigo não pode quebrar a faixa', () => {
    assert.equal(leCanalBloqueado({ slug: 'canario' }), null);
  });

  it('devolve null em bloqueio MUDO — pior que a dúvida honesta que ele substituiria', () => {
    assert.equal(leCanalBloqueado(painelBloqueado({ mensagem: '' })), null);
    assert.equal(leCanalBloqueado(painelBloqueado({ mensagem: '   ' })), null);
    assert.equal(leCanalBloqueado(painelBloqueado({ mensagem: 42 })), null);
  });

  it('não explode no que a rede pode devolver de estranho', () => {
    for (const cru of [null, undefined, 'bloqueado', 42, [], { canal_entrega: null }]) {
      assert.equal(leCanalBloqueado(cru), null, String(cru));
    }
  });

  it('contador e duração fora do formato viram 0, não NaN na tela', () => {
    const canal = leCanalBloqueado(
      painelBloqueado({ recusas_consecutivas: null, bloqueado_ha_segundos: -3 }),
    );
    assert.equal(canal?.recusasConsecutivas, 0);
    assert.equal(canal?.bloqueadoHaSegundos, 0);
  });
});

describe('frasePara — emenda com a frase da casa, que é minúscula e sem ponto', () => {
  it('afirma que NÃO entrou e diz o motivo, sem maiúscula no meio', () => {
    const canal = leCanalBloqueado(painelBloqueado())!;
    assert.equal(
      frasePara(canal),
      'não entrou — o campo de mensagem do agente está ocupado ou travado',
    );
  });

  it('não é a frase da dúvida: com o canal bloqueado não há risco de duplicar', () => {
    const canal = leCanalBloqueado(painelBloqueado())!;
    assert.doesNotMatch(frasePara(canal), /duplicar/i);
  });
});

describe('anuncioPara — quem ouve a tela recebe o que não cabe na linha', () => {
  it('leva contador e duração, que dizem se é teimosia ou primeira vez', () => {
    const anuncio = anuncioPara(leCanalBloqueado(painelBloqueado())!, 'Canário');
    assert.match(anuncio, /não chegou a Canário/);
    assert.match(anuncio, /2 tentativas seguidas/);
    assert.match(anuncio, /há 47 segundos/);
    assert.match(anuncio, /Destrave o agente/);
  });

  it('recusa única não vira "1 tentativas seguidas"', () => {
    const anuncio = anuncioPara(
      leCanalBloqueado(painelBloqueado({ recusas_consecutivas: 1 }))!,
      'Canário',
    );
    assert.doesNotMatch(anuncio, /tentativas seguidas/);
  });
});
