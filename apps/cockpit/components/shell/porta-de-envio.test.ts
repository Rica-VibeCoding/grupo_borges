import assert from 'node:assert/strict';
import { test } from 'node:test';

import { abrePorta, preparaEnvio } from './porta-de-envio.ts';

/**
 * A ESPINHA: o campo nunca esvazia sem despacho.
 *
 * É este par que reproduz o incidente. Antes, `composer.tsx:245` chamava
 * `setTexto('')` incondicionalmente e só depois consultava a máquina — o
 * equivalente a `limpaCampo: true, despacha: false`, que é o descarte com o
 * texto já apagado. Se algum dia alguém reintroduzir a limpeza otimista, é
 * aqui que quebra.
 */
test('campo esvaziado sem despacho é o descarte — nunca pode acontecer', () => {
  const casos = [
    { texto: 'sobe o build', compactando: true, faseEnvio: 'ocioso' as const },
    { texto: 'e a segunda', compactando: false, faseEnvio: 'aceito' as const },
    { texto: 'e a terceira', compactando: false, faseEnvio: 'enviando' as const },
    { texto: '  ', compactando: false, faseEnvio: 'ocioso' as const },
  ];

  for (const caso of casos) {
    const efeito = preparaEnvio(caso);
    assert.equal(efeito.despacha, false, 'este caso tem de ser recusado');
    assert.equal(
      efeito.limpaCampo,
      false,
      'recusou e ainda assim esvaziaria o campo: é exatamente a mensagem perdida de 05/08',
    );
  }
});

test('recusa que despacha nada tem de falar, salvo campo vazio', () => {
  assert.ok(preparaEnvio({ texto: 'oi', compactando: true, faseEnvio: 'ocioso' }).aviso);
  assert.equal(preparaEnvio({ texto: '', compactando: false, faseEnvio: 'ocioso' }).aviso, null);
});

test('liberado despacha e esvazia o campo no mesmo instante', () => {
  const efeito = preparaEnvio({ texto: 'vai', compactando: false, faseEnvio: 'ocioso' });
  assert.deepEqual(efeito, { despacha: true, limpaCampo: true, aviso: null });
});

/**
 * O teste que reproduz o incidente de 05/08: com o `/compact` em voo, o envio
 * era descartado por um `return` mudo e o campo já tinha sido limpo. A prova do
 * defeito é o SILÊNCIO, não a recusa — a recusa é legítima.
 */
test('envio durante o compact é recusado COM recado, nunca calado', () => {
  const porta = abrePorta({ texto: 'sobe o build', compactando: true, faseEnvio: 'ocioso' });

  assert.equal(porta.libera, false);
  assert.equal(porta.libera === false && porta.motivo, 'compactando');
  assert.ok(
    porta.libera === false && porta.recado && porta.recado.length > 0,
    'recusa sem recado é exatamente o descarte silencioso que sumiu com a mensagem do Rica',
  );
});

test('mensagem em rajada com a anterior sem confirmação é recusada COM recado', () => {
  for (const faseEnvio of ['enviando', 'aceito'] as const) {
    const porta = abrePorta({ texto: 'e a segunda', compactando: false, faseEnvio });
    assert.equal(porta.libera, false, `${faseEnvio} tem de segurar o envio`);
    assert.equal(porta.libera === false && porta.motivo, 'envio-em-voo');
    assert.ok(porta.libera === false && porta.recado, `${faseEnvio} recusou sem dizer nada`);
  }
});

/** A invariante do módulo. Qualquer motivo novo nasce obrigado a falar — é o
 *  que impede o próximo portão de repetir o incidente. */
test('toda recusa com texto na mão tem recado; só o campo vazio pode calar', () => {
  const casos = [
    { texto: 'oi', compactando: true, faseEnvio: 'ocioso' as const },
    { texto: 'oi', compactando: false, faseEnvio: 'enviando' as const },
    { texto: 'oi', compactando: false, faseEnvio: 'aceito' as const },
    { texto: '   ', compactando: false, faseEnvio: 'ocioso' as const },
    { compactando: true, faseEnvio: 'ocioso' as const },
    { texto: '', temAnexo: true, compactando: true, faseEnvio: 'ocioso' as const },
  ];

  for (const caso of casos) {
    const porta = abrePorta(caso);
    if (porta.libera) continue;
    if (porta.motivo === 'vazio') {
      assert.equal(porta.recado, null, 'campo vazio não tem gesto nem texto a preservar');
      continue;
    }
    assert.ok(porta.recado, `recusa ${porta.motivo} ficou muda`);
  }
});

/**
 * O defeito de 05/08 com roupa nova. Anexar a foto e tocar em enviar sem
 * escrever legenda é um GESTO — e caía na única recusa muda do módulo, que
 * existe para quando não há gesto nenhum. A foto ficaria retida, o toque não
 * faria nada e a tela não diria por quê.
 */
test('foto anexada sem legenda abre a porta — gesto não é campo vazio', () => {
  const porta = abrePorta({ texto: '', temAnexo: true, compactando: false, faseEnvio: 'ocioso' });
  assert.equal(porta.libera, true, 'anexo sem legenda é gesto e tem o que enviar');

  const soEspaco = abrePorta({
    texto: '   ',
    temAnexo: true,
    compactando: false,
    faseEnvio: 'ocioso',
  });
  assert.equal(soEspaco.libera, true, 'espaço em branco com foto na mão continua sendo gesto');
});

test('sem texto E sem anexo continua sendo o vazio de sempre', () => {
  const porta = abrePorta({ texto: '', temAnexo: false, compactando: false, faseEnvio: 'ocioso' });
  assert.equal(porta.libera, false);
  assert.equal(porta.libera === false && porta.motivo, 'vazio');
});

/**
 * A armadilha do outro lado: fazer o anexo LIBERAR em vez de só não contar como
 * vazio. Anexo durante o `/compact` corta o resumo ao meio igual ao texto, e
 * anexo com envio em voo atropela do mesmo jeito — as recusas que valem para o
 * texto valem para o gesto inteiro, e falando.
 */
test('anexo não fura as outras recusas, e elas continuam com recado', () => {
  const noCompact = abrePorta({
    texto: '',
    temAnexo: true,
    compactando: true,
    faseEnvio: 'ocioso',
  });
  assert.equal(noCompact.libera, false, 'foto durante o compact corta o resumo igual ao texto');
  assert.equal(noCompact.libera === false && noCompact.motivo, 'compactando');
  assert.ok(noCompact.libera === false && noCompact.recado, 'recusou a foto sem dizer nada');

  const emVoo = abrePorta({ texto: '', temAnexo: true, compactando: false, faseEnvio: 'enviando' });
  assert.equal(emVoo.libera, false);
  assert.ok(emVoo.libera === false && emVoo.recado);
});

/**
 * A recusa muda que sobrou da etapa 2. `controle.enviar` devolvia `false` calado
 * com um arquivo em voo — inalcançável enquanto o anexo saía pela gaveta, mas
 * assim que ele passa a sair pelo botão de enviar o Rica pode tocar duas vezes
 * durante a subida de um vídeo por Tailscale, que demora. A máquina segura o
 * segundo toque, e sem isto ela segura CALADA: o botão não responde e a tela não
 * diz por quê. `faseEnvio` não pega — é a fase da máquina de TEXTO, e upload em
 * voo não a move.
 */
test('segundo toque com arquivo subindo é recusado COM recado', () => {
  const porta = abrePorta({
    texto: 'de novo',
    temAnexo: true,
    anexoEmVoo: true,
    compactando: false,
    faseEnvio: 'ocioso',
  });

  assert.equal(porta.libera, false, 'o mesmo arquivo iria duas vezes ao agente');
  assert.equal(porta.libera === false && porta.motivo, 'anexo-em-voo');
  assert.ok(
    porta.libera === false && porta.recado,
    'a máquina já segurava o duplo envio — o que faltava era ela DIZER',
  );
});

test('sem arquivo em voo o gesto seguinte passa', () => {
  const porta = abrePorta({
    texto: 'segunda foto',
    temAnexo: true,
    anexoEmVoo: false,
    compactando: false,
    faseEnvio: 'ocioso',
  });
  assert.equal(porta.libera, true, 'anexo entregue não pode virar trava permanente');
});

test('a voz não tem campo, então "vazio" não é recusa possível pra ela', () => {
  const gravando = abrePorta({ compactando: false, faseEnvio: 'ocioso' });
  assert.equal(gravando.libera, true);

  const noCompact = abrePorta({ compactando: true, faseEnvio: 'ocioso' });
  assert.equal(noCompact.libera, false);
  assert.ok(noCompact.libera === false && noCompact.recado, 'áudio descartado calado é o mesmo bug');
});

test('fase confirmada ou falhada não segura a próxima mensagem', () => {
  for (const faseEnvio of ['ocioso', 'confirmado', 'nao-confirmado', 'falhou'] as const) {
    assert.equal(
      abrePorta({ texto: 'pode ir', compactando: false, faseEnvio }).libera,
      true,
      `${faseEnvio} não pode virar trava`,
    );
  }
});
