import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LIMITE_DE_TEXTO, abrePorta, preparaEnvio } from './porta-de-envio.ts';

/**
 * A ESPINHA: o campo nunca esvazia sem que o texto vá para ALGUM lugar visível.
 *
 * É este par que reproduz o incidente. Antes, `composer.tsx:245` chamava
 * `setTexto('')` incondicionalmente e só depois consultava a máquina — o
 * equivalente a `limpaCampo: true, despacha: false`, que é o descarte com o
 * texto já apagado. Se algum dia alguém reintroduzir a limpeza otimista, é
 * aqui que quebra.
 *
 * A invariante ganhou um segundo destino em 08/08 e NÃO afrouxou: a fila do
 * compact esvazia o campo sem despachar, e isso é legítimo porque o texto
 * aparece inteiro no bloco acima do composer, com o controle de trazê-lo de
 * volta. O que continua proibido é o campo esvaziar e o texto não estar em
 * lugar nenhum.
 */
test('campo esvaziado sem destino é o descarte — nunca pode acontecer', () => {
  const casos = [
    { texto: 'sobe o build', compactando: true, faseEnvio: 'ocioso' as const },
    { texto: 'e a segunda', compactando: false, faseEnvio: 'aceito' as const },
    { texto: 'e a terceira', compactando: false, faseEnvio: 'enviando' as const },
    { texto: '  ', compactando: false, faseEnvio: 'ocioso' as const },
    { texto: 'com foto', temAnexo: true, compactando: true, faseEnvio: 'ocioso' as const },
  ];

  for (const caso of casos) {
    const efeito = preparaEnvio(caso);
    assert.equal(efeito.despacha, false, 'este caso tem de ser recusado');
    if (efeito.limpaCampo) {
      assert.ok(
        efeito.enfileira,
        'esvaziou o campo sem despachar e sem enfileirar: é a mensagem perdida de 05/08',
      );
    }
  }
});

/**
 * A FILA. A frase "sua mensagem continua aqui e sai quando a barra sumir" era
 * mentira: nada reenviava. Agora o texto puro sai do campo, fica pendurado à
 * vista e é despachado sozinho — ver `fila-de-envio.ts`.
 */
test('texto recusado pelo compact vai para a fila, não fica preso no campo', () => {
  const efeito = preparaEnvio({ texto: 'sobe o build', compactando: true, faseEnvio: 'ocioso' });

  assert.equal(efeito.despacha, false, 'durante o compact nada sai — é a trava que gerou a peça');
  assert.equal(efeito.enfileira, true);
  assert.equal(efeito.limpaCampo, true, 'o texto saiu das mãos: deixá-lo no campo o duplicaria');
  assert.equal(
    efeito.aviso,
    null,
    'o bloco da fila já diz o que vai acontecer, e com o texto junto — repetir embaixo diria menos',
  );
});

test('só o texto puro entra na fila — anexo e retomada não têm onde ficar', () => {
  const comFoto = preparaEnvio({
    texto: 'olha isso',
    temAnexo: true,
    compactando: true,
    faseEnvio: 'ocioso',
  });
  assert.equal(comFoto.enfileira, false, 'a fila carrega texto, não arquivo');
  assert.equal(comFoto.limpaCampo, false);
  assert.ok(comFoto.aviso, 'e a recusa do anexo continua falando');
  assert.doesNotMatch(
    comFoto.aviso,
    /sai quando/,
    'com anexo o envio continua manual — prometer despacho é a mentira que esta rodada matou',
  );

  const pendurado = preparaEnvio({
    texto: 'sobe o build',
    compactando: true,
    faseEnvio: 'ocioso',
    retomada: true,
  });
  assert.equal(
    pendurado.enfileira,
    false,
    'a máquina já guarda o texto pendurado — enfileirar faria duas cópias que não se conhecem',
  );
});

/**
 * REVOGA a decisão anterior ("as esperas de segundos não viram bloco na tela",
 * que exigia `enfileira: false` aqui). A premissa dela era que `envio-em-voo`
 * dura uma viagem de rede — verdade no Claude Code, falsa na Tara, onde `aceito`
 * espera o rollout do `codex exec` (14 s medidos em 11/08, em
 * `aparencia-envio.ts`). Nesses segundos o texto ficava parado no campo com um
 * aviso que o teclado do celular esconde, e da tela do Rica isso é a mensagem
 * sendo engolida.
 */
test('mensagem escrita durante o envio anterior vai para a fila, não para o limbo', () => {
  for (const faseEnvio of ['enviando', 'aceito'] as const) {
    const efeito = preparaEnvio({ texto: 'e a segunda', compactando: false, faseEnvio });
    assert.equal(efeito.enfileira, true, `${faseEnvio} tem de pendurar o texto à vista`);
    assert.equal(efeito.limpaCampo, true, 'o texto saiu das mãos — o campo fica livre para a próxima');
    assert.equal(
      efeito.aviso,
      null,
      'quem fala é o bloco da fila, com o texto à vista; repetir embaixo diria menos',
    );
  }
});

test('a espera de uma SUBIDA continua sem bloco — o gesto carrega arquivo', () => {
  const efeito = preparaEnvio({
    texto: 'legenda',
    temAnexo: true,
    anexoEmVoo: true,
    compactando: false,
    faseEnvio: 'ocioso',
  });
  assert.equal(efeito.enfileira, false, 'a fila carrega texto, nunca arquivo');
  assert.ok(efeito.aviso, 'e continua falando, que é a invariante do módulo');
});

test('recusa que não enfileira tem de falar, salvo campo vazio', () => {
  // O exemplo era `faseEnvio: 'aceito'`, que passou a enfileirar em 15/08. A
  // invariante não mudou — mudou de quem ela precisa cobrar, e `longo-demais` é
  // uma recusa definitiva: não há espera que a resolva, então ela só pode falar.
  assert.ok(
    preparaEnvio({ texto: 'x'.repeat(LIMITE_DE_TEXTO + 1), compactando: false, faseEnvio: 'ocioso' })
      .aviso,
  );
  assert.equal(preparaEnvio({ texto: '', compactando: false, faseEnvio: 'ocioso' }).aviso, null);
});

test('liberado despacha e esvazia o campo no mesmo instante', () => {
  const efeito = preparaEnvio({ texto: 'vai', compactando: false, faseEnvio: 'ocioso' });
  assert.deepEqual(efeito, { despacha: true, enfileira: false, limpaCampo: true, aviso: null });
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

test('turno real do Codex barra o segundo gesto antes do POST e preserva o campo', () => {
  const entrada = {
    texto: 'segunda mensagem',
    turnoEmVoo: true,
    compactando: false,
    faseEnvio: 'confirmado',
  } as Parameters<typeof preparaEnvio>[0];
  const efeito = preparaEnvio(entrada);
  let posts = 0;
  if (efeito.despacha) posts += 1;

  assert.equal(posts, 0, 'o segundo POST nunca pode alcançar o backend durante isProcessing');
  assert.equal(efeito.despacha, false);
  assert.equal(efeito.enfileira, false);
  assert.equal(efeito.limpaCampo, false, 'o texto recusado continua no campo');
  assert.ok(efeito.aviso, 'a recusa preventiva precisa explicar por que o texto ficou');
});

/**
 * O outro motor. `turno-em-voo` nasceu para o Codex (`257d0f9`, 16/08), onde o
 * TeleCodex recusa com 409 `shared_turn_in_flight` e não há fila do outro lado
 * — mas `gerando`, no composer, vale para os dois, e o portão vazou para o
 * Claude Code, onde a fila EXISTE: o CLI enfileira o texto colado num pane
 * ocupado (`queue-operation`/`enqueue` no JSONL) e o stream devolve
 * `kind: "queued"`, que o painel já lê como confirmação de entrega — melhor que
 * o eco, porque prova que o texto entrou na caixa dele (`lib/envio.ts`,
 * `lib/usa-envio.ts`, `aparencia-envio.ts` com a frase "entrou na fila").
 *
 * Medido em 20/08 no banco vivo: 1.267 `enqueue` em ~3,5 dias, nenhum da Tara.
 * Entre eles, envios saídos deste composer — o `🎙 ` é carimbo de
 * `send_agent_input` para `origin=stt`, então aquele caminho foi POST → tmux →
 * fila do CLI, entregue, sem 409.
 *
 * Recusar aqui é negar no cliente uma entrega que o destino aceita.
 */
test('motor que enfileira sozinho não é barrado por turno em voo', () => {
  const porta = abrePorta({
    texto: 'segunda mensagem',
    turnoEmVoo: true,
    motorEnfileiraSozinho: true,
    compactando: false,
    faseEnvio: 'confirmado',
  });
  assert.equal(porta.libera, true, 'o CLI enfileira do outro lado — a porta não tem o que segurar');
});

test('com fila do outro lado o gesto despacha e o campo esvazia', () => {
  const efeito = preparaEnvio({
    texto: 'segunda mensagem',
    turnoEmVoo: true,
    motorEnfileiraSozinho: true,
    compactando: false,
    faseEnvio: 'confirmado',
  });
  assert.equal(efeito.despacha, true, 'o POST tem de alcançar o backend');
  assert.equal(efeito.limpaCampo, true, 'despachou: o texto saiu do campo para o feed');
  assert.equal(efeito.enfileira, false, 'a fila local é do compact — esta é a do CLI');
  assert.equal(efeito.aviso, null, 'não é recusa, não há o que avisar');
});

/**
 * A trava não some para quem não tem fila: sem `motorEnfileiraSozinho` o portão
 * continua inteiro, porque do outro lado o 409 é real.
 */
test('sem fila do outro lado o turno em voo continua barrando', () => {
  const porta = abrePorta({
    texto: 'segunda mensagem',
    turnoEmVoo: true,
    compactando: false,
    faseEnvio: 'confirmado',
  });
  assert.equal(porta.libera, false, 'no Codex a recusa continua sendo o desenho certo');
  assert.equal(porta.libera === false && porta.motivo, 'turno-em-voo');
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

/**
 * O OUTRO ÂNGULO DO MESMO DESCARTE. O "Tentar de novo"/"Reenviar" da linha de
 * estado despacha o texto que ficou PENDURADO na máquina — e o campo, nesse
 * instante, guarda outra coisa: o que o Rica escreveu enquanto olhava a faixa
 * de erro (o textarea nunca é `disabled`, justamente para ele poder escrever
 * durante a espera). O campo não contém o corpo que está saindo, então
 * esvaziá-lo não limpa o gesto: come uma mensagem que nunca virou requisição,
 * sem aviso e sem sobrar em lugar nenhum. É 05/08 com outra roupa.
 */
test('retomada despacha o pendurado e NÃO come o que está no campo', () => {
  for (const faseEnvio of ['falhou', 'nao-confirmado'] as const) {
    const efeito = preparaEnvio({
      texto: 'sobe o build',
      compactando: false,
      faseEnvio,
      retomada: true,
    });

    assert.equal(efeito.despacha, true, `${faseEnvio} tem de deixar o reenvio sair`);
    assert.equal(
      efeito.limpaCampo,
      false,
      'o campo guarda outra mensagem — esvaziá-lo apaga o que o Rica escreveu esperando',
    );
  }
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

test('texto no limite exato passa pela porta', () => {
  const texto = 'a'.repeat(LIMITE_DE_TEXTO);

  assert.equal(
    abrePorta({ texto, compactando: false, faseEnvio: 'ocioso' }).libera,
    true,
  );
});

test('um caractere acima do limite é recusado, com o campo preservado', () => {
  const texto = 'a'.repeat(LIMITE_DE_TEXTO + 1);
  const porta = abrePorta({ texto, compactando: false, faseEnvio: 'ocioso' });
  const efeito = preparaEnvio({ texto, compactando: false, faseEnvio: 'ocioso' });

  assert.equal(porta.libera, false);
  assert.equal(porta.libera === false && porta.motivo, 'longo-demais');
  // O recado precisa dizer os DOIS números: sem o teto, "longo demais" não diz
  // quanto cortar. Montado do limite real para não congelar aqui um número que
  // o backend já mudou uma vez.
  assert.equal(
    porta.libera === false && porta.recado,
    `texto longo demais — ${(LIMITE_DE_TEXTO + 1).toLocaleString('pt-BR')} de ${LIMITE_DE_TEXTO.toLocaleString('pt-BR')} caracteres`,
  );
  assert.equal(efeito.despacha, false);
  assert.equal(efeito.limpaCampo, false, 'a recusa mantém o texto editável no campo');
});

test('o log colado que o limite do stub recusava agora passa', () => {
  // 8192 era o valor do stub (ffae5d7). Este teste é a régua do gesto real do
  // Rica — colar um trecho grande — e falha se alguém devolver o teto antigo.
  const texto = 'x'.repeat(20000);

  assert.equal(
    abrePorta({ texto, compactando: false, faseEnvio: 'ocioso' }).libera,
    true,
  );
});

test('emoji fora do BMP ocupa duas unidades UTF-16 e é barrado conservadoramente', () => {
  const texto = `${'a'.repeat(LIMITE_DE_TEXTO - 1)}😀`;

  assert.equal([...texto].length, LIMITE_DE_TEXTO, 'o emoji é um único code point');
  assert.equal(texto.length, LIMITE_DE_TEXTO + 1, 'String.length conta unidades UTF-16');
  assert.equal(
    abrePorta({ texto, compactando: false, faseEnvio: 'ocioso' }).libera,
    false,
    'a guarda por UTF-16 é conservadora diante do limite por code points do backend',
  );
});
