import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  aparenciaDe,
  emTransito,
  rotulaAcao,
  type FaseEnvio,
} from './aparencia-envio.ts';
import { descreveMotor, leMotor, rotulaEsforco, rotulaModelo, textoDoMotor } from './motor.ts';

const TODAS: FaseEnvio[] = [
  'ocioso',
  'enviando',
  'aceito',
  'confirmado',
  'nao-confirmado',
  'falhou',
];

describe('aceito × confirmado — o defeito de hoje é os dois parecerem a mesma coisa', () => {
  it('difere em QUATRO sinais, e nenhum deles exige ler texto', () => {
    const a = aparenciaDe('aceito', 'Daniel');
    const c = aparenciaDe('confirmado', 'Daniel');

    assert.notEqual(a.fio, c.fio, 'movimento: o que se mexe ainda não chegou');
    assert.notEqual(a.assentada, c.assentada, 'fio de luz + peso do texto');
    assert.notEqual(a.filete, c.filete, 'filete de estado à esquerda');
  });

  it('aceito NÃO pode parecer sucesso — é espera', () => {
    const a = aparenciaDe('aceito', 'Daniel');
    assert.equal(a.assentada, false);
    assert.equal(a.fio, 'correndo');
    assert.match(a.frase ?? '', /esperando/);
  });

  it('confirmado é o único que canta sucesso, e canta calado', () => {
    const c = aparenciaDe('confirmado', 'Daniel');
    assert.equal(c.frase, null, 'sucesso é silêncio — igual à linha de ferramenta');
    assert.equal(c.assentada, true);
    assert.deepEqual(c.acoes, []);
  });
});

describe('não confirmado — diagnóstico, não erro', () => {
  it('avisa que mandar de novo duplica: é a informação que impede o dano', () => {
    const p = aparenciaDe('nao-confirmado', 'Daniel');
    assert.match(p.frase ?? '', /duplica/i);
    assert.match(p.anuncio, /duplicar/i);
  });

  it('não afirma entrega nem falha e manda conferir o chat', () => {
    const p = aparenciaDe('nao-confirmado', 'Hiro');
    assert.match(p.frase ?? '', /não consegui confirmar/i);
    assert.match(p.frase ?? '', /confira no chat/i);
    assert.doesNotMatch(p.frase ?? '', /não saiu|nada foi entregue/i);
  });

  it('oferece a decisão ao humano e nunca decide sozinho', () => {
    assert.deepEqual(aparenciaDe('nao-confirmado', 'Daniel').acoes, ['reenviar', 'copiar']);
  });

  it('o fio TRAVA no meio: a imagem do que aconteceu', () => {
    assert.equal(aparenciaDe('nao-confirmado', 'Daniel').fio, 'travado');
  });

  it('usa o âmbar de ESPERA HUMANO, não o vermelho — não é erro', () => {
    assert.equal(aparenciaDe('nao-confirmado', 'Daniel').filete, 'var(--ck-state-attention)');
    assert.equal(aparenciaDe('falhou', 'Daniel').filete, 'var(--ck-state-fail)');
  });
});

describe('falha', () => {
  it('perde o fio de luz — luz é vida, e esta mensagem não vive', () => {
    assert.equal(aparenciaDe('falhou', 'Daniel').assentada, false);
    assert.equal(aparenciaDe('falhou', 'Daniel').fio, 'nenhum');
  });
});

describe('anúncio para leitor de tela', () => {
  it('só interrompe quem precisa de decisão humana', () => {
    const assertivas = TODAS.filter((f) => aparenciaDe(f, 'Daniel').urgencia === 'assertive');
    assert.deepEqual(assertivas, ['nao-confirmado', 'falhou']);
  });

  it('toda fase visível tem anúncio, mesmo as que não escrevem na tela', () => {
    for (const fase of TODAS) {
      if (fase === 'ocioso') continue;
      assert.ok(aparenciaDe(fase, 'Daniel').anuncio.length > 0, fase);
    }
  });
});

describe('em trânsito', () => {
  it('só enviando e aceito ainda mudam sozinhos', () => {
    assert.deepEqual(TODAS.filter(emTransito), ['enviando', 'aceito']);
  });
});

describe('rótulo de ação', () => {
  it('é voz ativa e diz o que acontece', () => {
    assert.equal(rotulaAcao('reenviar'), 'Mandar de novo');
    assert.equal(rotulaAcao('tentar-de-novo'), 'Tentar de novo');
    assert.equal(rotulaAcao('destravar'), 'Destravar agente');
  });
});

/**
 * O canal bloqueado é a única coisa que sabe MAIS que a máquina de envio: ela
 * não observou o eco, ele observou a recusa. Quando ele fala, a faixa troca a
 * dúvida honesta por um diagnóstico com ação.
 */
describe('canal bloqueado — a faixa deixa de perguntar e passa a responder', () => {
  const CANAL = {
    mensagem: 'O campo de mensagem do agente está ocupado ou travado.',
    recusasConsecutivas: 2,
    bloqueadoHaSegundos: 47,
  };

  it('sem canal bloqueado, a dúvida honesta continua intacta', () => {
    const a = aparenciaDe('nao-confirmado', 'Canário');
    assert.match(a.frase ?? '', /não consegui confirmar/);
    assert.deepEqual(a.acoes, ['reenviar', 'copiar']);
  });

  it('com o canal bloqueado, diz o motivo em vez de "não sei"', () => {
    const a = aparenciaDe('nao-confirmado', 'Canário', { canalBloqueado: CANAL });
    assert.match(a.frase ?? '', /não entrou/);
    assert.match(a.frase ?? '', /ocupado ou travado/);
    assert.doesNotMatch(a.frase ?? '', /não consegui confirmar/);
  });

  it('tira o "mandar de novo" do amarelo: com o canal fechado o gesto não entrega', () => {
    const a = aparenciaDe('nao-confirmado', 'Canário', { canalBloqueado: CANAL });
    assert.deepEqual(a.acoes, ['destravar', 'copiar']);
  });

  it('o filete continua âmbar — a decisão ainda é humana', () => {
    const a = aparenciaDe('nao-confirmado', 'Canário', { canalBloqueado: CANAL });
    assert.equal(a.filete, 'var(--ck-state-attention)');
    assert.equal(a.urgencia, 'assertive');
  });

  it('o anúncio leva o que não cabe na linha: contador e duração', () => {
    const a = aparenciaDe('nao-confirmado', 'Canário', { canalBloqueado: CANAL });
    assert.match(a.anuncio, /2 tentativas seguidas/);
    assert.match(a.anuncio, /47 segundos/);
  });

  /**
   * O 409 `agent_pane_unavailable` — que é a recusa do driver, o caminho MAIS
   * direto do canal bloqueado — cai em `falhou`, não no amarelo
   * (`usa-envio.ts:371`: rejeição HTTP vira `falhar`). Cobrir só o amarelo
   * deixaria mudo justamente o estado onde o bloqueio aparece primeiro.
   */
  it('o vermelho também ganha o motivo — é onde o 409 do canal cai', () => {
    const a = aparenciaDe('falhou', 'Canário', { canalBloqueado: CANAL });
    assert.match(a.frase ?? '', /ocupado ou travado/);
    assert.equal(a.filete, 'var(--ck-state-fail)');
  });

  it('no vermelho o "tentar de novo" FICA — ali a mensagem não saiu, não duplica', () => {
    const a = aparenciaDe('falhou', 'Canário', { canalBloqueado: CANAL });
    assert.deepEqual(a.acoes, ['destravar', 'tentar-de-novo']);
  });

  /**
   * Medido no canário em 05/08: com texto humano armado, o `/destrava` devolve
   * `tmux_delivered: false` / `texto_armado_nao_recuperavel`. E
   * `input_ocupado_ou_travado` é o motivo mais comum — logo é o caminho
   * frequente, não a borda.
   */
  it('destrava que não resolveu FALA, em vez de deixar o botão mudo', () => {
    const a = aparenciaDe('nao-confirmado', 'Canário', {
      canalBloqueado: CANAL,
      destravaFalhou: true,
    });
    assert.match(a.frase ?? '', /destrava não resolveu/);
    assert.match(a.frase ?? '', /terminal de Canário/);
  });

  it('e para de oferecer o botão que já provou não resolver', () => {
    const a = aparenciaDe('nao-confirmado', 'Canário', {
      canalBloqueado: CANAL,
      destravaFalhou: true,
    });
    assert.deepEqual(a.acoes, ['copiar']);
    const v = aparenciaDe('falhou', 'Canário', {
      canalBloqueado: CANAL,
      destravaFalhou: true,
    });
    // No vermelho o "tentar de novo" fica: o Rica pode ter aberto o terminal e
    // resolvido à mão entre um toque e outro.
    assert.deepEqual(v.acoes, ['tentar-de-novo']);
  });

  it('sem bloqueio, um destrava velho não inventa frase nenhuma', () => {
    const a = aparenciaDe('nao-confirmado', 'Canário', { destravaFalhou: true });
    assert.match(a.frase ?? '', /não consegui confirmar/);
    assert.deepEqual(a.acoes, ['reenviar', 'copiar']);
  });

  it('não contamina o caminho feliz — canal velho não fala por envio que deu certo', () => {
    for (const fase of ['ocioso', 'enviando', 'aceito', 'confirmado'] as FaseEnvio[]) {
      const com = aparenciaDe(fase, 'Canário', { canalBloqueado: CANAL });
      assert.deepEqual(com, aparenciaDe(fase, 'Canário'), fase);
    }
  });
});

describe('motor — modelo e esforço dentro do composer', () => {
  it('traduz as três famílias para o nome que o Rica usa — mesma tabela da tropa', () => {
    assert.equal(rotulaModelo('claude-opus-5'), 'Opus 5');
    assert.equal(rotulaModelo('claude-opus-4-8'), 'Opus 4.8');
    assert.equal(rotulaModelo('codex-gpt-5-6-sol'), 'GPT-5.6 Sol');
    assert.equal(rotulaModelo('kimi-for-coding-highspeed'), 'K2.7 rápido');
    assert.equal(rotulaModelo('k3'), 'K3');
  });

  it('alias curto sem versão (visto em produção: state_model="opus") vira só a família', () => {
    assert.equal(rotulaModelo('opus'), 'Opus');
    assert.equal(rotulaModelo('sonnet'), 'Sonnet');
  });

  it('modelo desconhecido devolve o slug cru — nome bonito inventado é mentira', () => {
    assert.equal(rotulaModelo('claude-opus-9'), 'claude-opus-9');
    assert.equal(rotulaModelo(null), 'sem modelo');
  });

  it('esforço sai em português', () => {
    assert.equal(rotulaEsforco('xhigh'), 'extra alto');
    assert.equal(rotulaEsforco('max'), 'máximo');
    assert.equal(rotulaEsforco(null), null);
  });

  it('prefere o modelo da SESSÃO ao da config — é o que está rodando', () => {
    const m = leMotor({ modeloSessao: 'claude-opus-5', modeloPadrao: 'claude-opus-4-8' });
    assert.equal(m.modelo, 'Opus 5');
  });

  it('sem valor de sessão, o que sobra é config e a certeza CAI', () => {
    const m = leMotor({ modeloSessao: null, modeloPadrao: 'claude-opus-4-8' });
    assert.equal(m.modelo, 'Opus 4.8');
    assert.equal(m.certeza, 'pode-divergir');
  });

  it('a ressalva do back não some: entra por extenso no anúncio', () => {
    const m = leMotor({ modeloPadrao: 'claude-opus-5', esforco: 'xhigh' });
    assert.match(descreveMotor(m), /pode estar em outro valor/);
  });

  it('valor lido da sessão não carrega ressalva', () => {
    const m = leMotor({
      modeloSessao: 'claude-opus-5',
      esforco: 'high',
      podeDivergir: false,
    });
    assert.equal(m.certeza, 'lido');
    assert.equal(descreveMotor(m), 'Motor: Opus 5, esforço alto');
  });

  it('o texto do controle cabe numa linha e some o esforço quando não há', () => {
    assert.equal(textoDoMotor(leMotor({ modeloSessao: 'claude-opus-5', esforco: 'xhigh' })), 'Opus 5 · extra alto');
    assert.equal(textoDoMotor(leMotor({ modeloSessao: 'claude-opus-5' })), 'Opus 5');
  });
});
