import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  AVISO_SEGUNDOS,
  LIMIAR_CANCELA,
  LIMIAR_TRAVA,
  PISO_SEGUNDOS,
  aoEnviarTravada,
  aoSoltar,
  aparenciaDaVoz,
  assinaturaDoContainer,
  capturando,
  diagnosticaMicrofone,
  diagnosticaTranscricao,
  duracaoLegivel,
  escolheMime,
  extensaoDe,
  gestoDe,
  impedimentoDeContexto,
  mesclaTranscricao,
  normalizaMime,
  origemDepoisDaEdicao,
  progressoDoGesto,
  suavizaNiveis,
  type FaseVoz,
} from './voz.ts';

const TODAS: FaseVoz[] = [
  'ociosa',
  'pedindo',
  'gravando',
  'cancelando',
  'travada',
  'transcrevendo',
  'impedida',
];

describe('transcrição vira rascunho', () => {
  it('preenche o campo vazio sem marcador visível', () => {
    assert.equal(mesclaTranscricao('', 'texto para revisar'), 'texto para revisar');
  });

  it('não apaga o que foi digitado enquanto o servidor transcrevia', () => {
    assert.equal(
      mesclaTranscricao('começo já escrito', 'continuação falada'),
      'começo já escrito\ncontinuação falada',
    );
  });

  it('mantém origem de voz durante revisão parcial', () => {
    assert.equal(origemDepoisDaEdicao('stt', 'texto revisado', false), 'stt');
  });

  it('substituir o campo inteiro transforma o novo texto em digitado', () => {
    assert.equal(origemDepoisDaEdicao('stt', '/clear', true), 'text');
    assert.equal(origemDepoisDaEdicao('stt', '', false), 'text');
  });
});

describe('onda da captura', () => {
  it('amortece picos bruscos sem congelar a resposta à fala', () => {
    assert.deepEqual(suavizaNiveis([0, 100], [100, 0]), [42, 82]);
  });
});

describe('o gesto — segurar, e as duas saídas', () => {
  it('parado no botão é só segurar', () => {
    assert.equal(gestoDe(0, 0), 'segurando');
    assert.equal(gestoDe(-10, -8), 'segurando');
  });

  it('arrastar pra ESQUERDA além do limiar arma o cancelamento', () => {
    assert.equal(gestoDe(-LIMIAR_CANCELA, 0), 'cancelar');
    assert.equal(gestoDe(-LIMIAR_CANCELA + 1, 0), 'segurando');
  });

  it('arrastar pra CIMA além do limiar arma a trava', () => {
    assert.equal(gestoDe(0, -LIMIAR_TRAVA), 'travar');
    assert.equal(gestoDe(0, -LIMIAR_TRAVA + 1), 'segurando');
  });

  it('travar é mais perto que cancelar — a saída comum exige menos esforço', () => {
    assert.ok(LIMIAR_TRAVA < LIMIAR_CANCELA);
  });

  it('arrastar pra DIREITA ou pra BAIXO não faz nada: só um sentido por eixo', () => {
    assert.equal(gestoDe(200, 0), 'segurando');
    assert.equal(gestoDe(0, 200), 'segurando');
  });

  it('na diagonal o eixo dominante decide — sem isso o resultado é sorteio', () => {
    // mais pra cima que pro lado, ambos além do limiar
    assert.equal(gestoDe(-90, -140), 'travar');
    // mais pro lado que pra cima
    assert.equal(gestoDe(-140, -90), 'cancelar');
  });

  it('o progresso satura em 1 e nunca vai a negativo', () => {
    assert.equal(progressoDoGesto(0, 0), 0);
    assert.equal(progressoDoGesto(0, -LIMIAR_TRAVA * 3), 1);
    assert.equal(progressoDoGesto(0, 999), 0);
    assert.ok(progressoDoGesto(0, -LIMIAR_TRAVA / 2) > 0.4);
  });
});

describe('soltar o dedo', () => {
  it('soltar segurando ENVIA', () => {
    assert.equal(aoSoltar('segurando', 5), 'enviar');
  });

  it('soltar na zona de cancelamento DESCARTA', () => {
    assert.equal(aoSoltar('cancelar', 30), 'descartar-cancelado');
  });

  it('soltar travado não encerra nada — o gesto acabou, a gravação não', () => {
    assert.equal(aoSoltar('travar', 2), 'continuar');
  });

  it('soltar antes do piso TRAVA — é o clique curto, não um gesto rejeitado', () => {
    // A regra que matou o pisca de 20/08: descartar aqui fazia a tela abrir e
    // fechar dentro de um clique, com o aviso "muito curto" acendendo em cima
    // da caixa. Quem decide se o áudio parte é o piso do DESPACHO
    // (`aoEnviarTravada`), não o de soltar o dedo.
    assert.equal(aoSoltar('segurando', PISO_SEGUNDOS - 0.5), 'continuar');
    assert.equal(aoSoltar('segurando', PISO_SEGUNDOS), 'enviar');
  });

  it('cancelar vence o piso: quem cancelou não quis mandar, curto ou longo', () => {
    assert.equal(aoSoltar('cancelar', 0), 'descartar-cancelado');
  });

  it('o botão de enviar da travada obedece o MESMO piso do gesto solto', () => {
    // A trava tem porta própria: `enviarTravada` não passa por `aoSoltar`, e
    // sem piso ali um toque de travar seguido de enviar despacha uma gravação
    // de milissegundos. O log da API registrou `audio_duration_ms=43` em 20/08:
    // a OpenAI recusou com 400, o fallback local queimou 22s e voltou vazio.
    assert.equal(aoEnviarTravada(0), 'descartar-curto');
    assert.equal(aoEnviarTravada(PISO_SEGUNDOS), 'enviar');
  });
});

describe('microfone indisponível — nunca um botão que não responde', () => {
  it('toda saída é acionável, nunca só o diagnóstico', () => {
    for (const nome of ['NotAllowedError', 'NotFoundError', 'NotReadableError', 'AbortError', '?']) {
      const d = diagnosticaMicrofone({ name: nome });
      assert.ok(d.resumo.length > 0, nome);
      assert.ok(d.saida.length > 0, nome);
    }
  });

  it('permissão negada ensina ONDE mexer no iPhone', () => {
    const d = diagnosticaMicrofone({ name: 'NotAllowedError' });
    assert.match(d.saida, /Ajustes|Site/);
    assert.equal(d.definitivo, true, 'insistir no mesmo lugar não resolve');
  });

  it('microfone ocupado é temporário: vale tentar de novo', () => {
    assert.equal(diagnosticaMicrofone({ name: 'NotReadableError' }).definitivo, false);
  });

  it('contexto inseguro nomeia a causa REAL — abrir pelo IP em vez do .ts.net', () => {
    const d = impedimentoDeContexto();
    assert.match(d.saida, /ts\.net/);
    assert.match(d.saida, /IP|100\.x/);
  });

  it('STT que falha no servidor também sai com o que fazer, nunca só o problema', () => {
    for (const detalhe of ['stt_empty', 'stt_timeout', 'stt_failed', 'stt_script_not_found', '422', 'ruído']) {
      const d = diagnosticaTranscricao(new Error(`postAgentTranscription 502: {"detail":"${detalhe}"}`));
      assert.ok(d.resumo.length > 0, detalhe);
      assert.ok(d.saida.length > 0, detalhe);
    }
  });

  it('áudio mudo ensina o gesto certo — o começo da fala é o que se perde', () => {
    const d = diagnosticaTranscricao(new Error('postAgentTranscription 502: {"detail":"stt_empty"}'));
    assert.match(d.saida, /segure|espere/i);
    assert.equal(d.definitivo, false, 'falar de novo resolve');
  });

  it('script de STT ausente é infra: não manda o Rica tentar de novo em vão', () => {
    const d = diagnosticaTranscricao(new Error('stt_script_not_found: /x/stt.sh'));
    assert.equal(d.definitivo, true);
    assert.match(d.saida, /texto/);
  });

  it('erro genérico não afirma que nada foi entregue', () => {
    const d = diagnosticaTranscricao(new Error('Failed to fetch'));
    assert.match(d.resumo, /não consegui confirmar/i);
    assert.match(d.saida, /confira no chat/i);
    assert.match(d.saida, /duplicar/i);
    assert.doesNotMatch(`${d.resumo} ${d.saida}`, /nada foi entregue|não chegou ao agente/i);
  });

  it('erro sem `name` não quebra o diagnóstico', () => {
    assert.ok(diagnosticaMicrofone(undefined).saida.length > 0);
    assert.ok(diagnosticaMicrofone('deu ruim').saida.length > 0);
  });
});

describe('formato do áudio — o que o back aceita', () => {
  it('o parâmetro de codec cai fora: é o que o Safari costuma anexar', () => {
    assert.equal(normalizaMime('audio/webm;codecs=opus'), 'audio/webm');
    assert.equal(normalizaMime('audio/mp4; codecs="mp4a.40.2"'), 'audio/mp4');
  });

  it('container MP4 rotulado como VÍDEO vira áudio — o arquivo é o mesmo', () => {
    // O WebKit já devolveu `video/mp4` para captura só-áudio. O back salva tudo
    // como .oga e deixa o ffmpeg decidir pelo conteúdo; recusar pelo rótulo
    // perderia a fala por burocracia.
    assert.equal(normalizaMime('video/mp4'), 'audio/mp4');
  });

  it('tipo vazio devolve null em vez de subir octet-stream e tomar 422', () => {
    assert.equal(normalizaMime(''), null);
    assert.equal(normalizaMime(null), null);
    assert.equal(normalizaMime('application/octet-stream'), null);
  });

  it('a escolha prefere opus, e cai pra mp4 no Safari', () => {
    assert.equal(escolheMime(() => true), 'audio/webm;codecs=opus');
    // Safari iOS: não suporta webm, suporta mp4.
    assert.equal(escolheMime((m) => m === 'audio/mp4'), 'audio/mp4');
    assert.equal(escolheMime(() => false), null);
  });

  it('o que a escolha devolve sobrevive à normalização — senão gravaríamos o que o back recusa', () => {
    for (const suporta of [() => true, (m: string) => m === 'audio/mp4', (m: string) => m === 'audio/ogg']) {
      const escolhido = escolheMime(suporta);
      assert.ok(escolhido);
      assert.ok(normalizaMime(escolhido), escolhido);
    }
  });

  it('a extensão acompanha o mime', () => {
    assert.equal(extensaoDe('audio/mp4'), 'm4a');
    assert.equal(extensaoDe('audio/webm'), 'webm');
    assert.equal(extensaoDe('audio/ogg'), 'ogg');
  });
});

describe('aparência da captura', () => {
  it('as duas saídas do gesto aparecem NA TELA enquanto ele acontece', () => {
    const a = aparenciaDaVoz('gravando', { segundos: 3 });
    assert.match(a.instrucao, /cancelar/);
    assert.match(a.instrucao, /travar/);
  });

  it('prestes a cancelar é vermelho e diz o que soltar faz', () => {
    const c = aparenciaDaVoz('cancelando', { segundos: 3 });
    assert.equal(c.tinta, 'var(--ck-state-fail)');
    assert.match(c.instrucao, /descartar/);
  });

  it('gravando e prestes-a-cancelar NÃO se parecem — a cor separa', () => {
    assert.notEqual(
      aparenciaDaVoz('gravando', { segundos: 3 }).tinta,
      aparenciaDaVoz('cancelando', { segundos: 3 }).tinta,
    );
  });

  it('a onda só existe quando há som entrando de fato', () => {
    const comOnda = TODAS.filter((f) => aparenciaDaVoz(f).mostraOnda);
    assert.deepEqual(comOnda, ['gravando', 'cancelando', 'travada']);
    assert.deepEqual(comOnda, TODAS.filter(capturando));
  });

  it('áudio longo avisa ANTES de estourar o STT, em vez de perder a fala', () => {
    const curta = aparenciaDaVoz('gravando', { segundos: AVISO_SEGUNDOS - 1 });
    const longa = aparenciaDaVoz('gravando', { segundos: AVISO_SEGUNDOS });
    assert.equal(curta.longa, false);
    assert.equal(longa.longa, true);
    assert.match(longa.instrucao, /transcri/);
    assert.equal(longa.tinta, 'var(--ck-state-attention)');
  });

  it('transcrevendo NÃO fica mudo: o STT roda no servidor e o tempo morto é real', () => {
    const t = aparenciaDaVoz('transcrevendo', { nome: 'Daniel' });
    assert.match(t.instrucao, /transcrevendo/);
    assert.match(t.anuncio, /Daniel/);
    assert.equal(t.mostraOnda, false, 'não há mais som entrando');
  });

  it('toda fase de ESPERA tem palavra, não só fio — fio não diz DE QUE se espera', () => {
    // O print da vitrine pegou isto: `transcrevendo` mostrava só o fio correndo
    // na base, indistinguível de "enviando texto".
    for (const fase of ['pedindo', 'transcrevendo'] as const) {
      assert.ok(aparenciaDaVoz(fase).instrucao.length > 0, fase);
    }
  });

  it('travada e longa continua avisando do teto do STT — cor sem motivo é enfeite', () => {
    const t = aparenciaDaVoz('travada', { segundos: AVISO_SEGUNDOS + 10 });
    assert.equal(t.longa, true);
    assert.match(t.instrucao, /transcri/);
    assert.equal(t.tinta, 'var(--ck-state-attention)');
  });

  it('travada oferece o botão de enviar; segurando não — ali quem manda é o dedo', () => {
    assert.equal(aparenciaDaVoz('travada').botao, 'enviar-audio');
    assert.equal(aparenciaDaVoz('gravando').botao, 'nenhum');
    assert.equal(aparenciaDaVoz('ociosa').botao, 'enviar-texto');
  });

  it('impedida carrega a saída junto do problema', () => {
    const a = aparenciaDaVoz('impedida', { impedimento: diagnosticaMicrofone({ name: 'NotAllowedError' }) });
    assert.match(a.anuncio, /Ajustes|Site/);
  });

  it('toda fase de captura tem anúncio para leitor de tela', () => {
    for (const fase of TODAS) {
      if (fase === 'ociosa') continue;
      assert.ok(aparenciaDaVoz(fase, { impedimento: impedimentoDeContexto() }).anuncio.length > 0, fase);
    }
  });
});

describe('duração', () => {
  it('conta em minutos e segundos com dois dígitos', () => {
    assert.equal(duracaoLegivel(0), '0:00');
    assert.equal(duracaoLegivel(7), '0:07');
    assert.equal(duracaoLegivel(75), '1:15');
    assert.equal(duracaoLegivel(600), '10:00');
  });

  it('não mostra número negativo nem quebrado', () => {
    assert.equal(duracaoLegivel(-3), '0:00');
    assert.equal(duracaoLegivel(7.9), '0:07');
  });
});

describe('assinatura do container', () => {
  const bytes = (vals: number[]) => Uint8Array.from(vals);

  it('webm íntegro começa no magic EBML — 1a 45 df a3', () => {
    assert.equal(
      assinaturaDoContainer('audio/webm', bytes([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81])),
      true,
    );
  });

  it('webm corrompido — começa no meio da fala — é rejeitado', () => {
    // Cluster (1f 43 b6 75) sem header à frente: o blob que o bug produziu.
    assert.equal(
      assinaturaDoContainer('audio/webm', bytes([0x1f, 0x43, 0xb6, 0x75, 0x81, 0x01, 0x00, 0x00])),
      false,
    );
  });

  it('o parâmetro de codec não atrapalha a checagem', () => {
    assert.equal(
      assinaturaDoContainer('audio/webm;codecs=opus', bytes([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0])),
      true,
    );
  });

  it('mp4 íntegro carrega "ftyp" no offset 4', () => {
    assert.equal(
      assinaturaDoContainer('audio/mp4', bytes([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70])),
      true,
    );
  });

  it('mp4 sem "ftyp" é rejeitado', () => {
    assert.equal(
      assinaturaDoContainer('audio/mp4', bytes([0x00, 0x00, 0x00, 0x18, 0x00, 0x00, 0x00, 0x00])),
      false,
    );
  });

  it('formato sem assinatura conhecida passa — o back decide', () => {
    assert.equal(assinaturaDoContainer('audio/ogg', bytes([0x4f, 0x67, 0x67, 0x53, 0, 0, 0, 0])), true);
    assert.equal(assinaturaDoContainer(null, bytes([0, 0, 0, 0, 0, 0, 0, 0])), true);
  });

  it('cabeça curta demais nunca é saudável', () => {
    assert.equal(assinaturaDoContainer('audio/webm', bytes([0x1a, 0x45])), false);
    assert.equal(assinaturaDoContainer('audio/mp4', bytes([0, 0, 0, 0, 0x66, 0x74])), false);
  });
});
