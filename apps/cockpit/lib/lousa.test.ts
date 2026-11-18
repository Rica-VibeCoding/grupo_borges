import assert from 'node:assert/strict';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';

import { colunasDaLousa, ehLousa, textoDoPre, trechoFalado } from './lousa.ts';
import { perfilDo } from './perfil-do-agente.ts';

const LOUSA = [
  '┌──── POR QUE O CÉU É AZUL ────┐',
  '│ A luz do sol tem TODAS as    │',
  '│ cores misturadas.            │',
  '└──────────────────────────────┘',
].join('\n');

const RESPOSTA_DO_TED = [
  'Uau, boa pergunta! ⚽',
  '```',
  LOUSA,
  '```',
  '> [!IMPORTANT]',
  '> Desafio: de que cor fica o céu no pôr do sol? 🤔',
].join('\n');

test('moldura fechada é lousa; código e diagrama solto não são', () => {
  assert.equal(ehLousa(LOUSA), true);
  assert.equal(ehLousa(`\n${LOUSA}\n\n`), true);
  assert.equal(ehLousa('const a = 1;\nconsole.log(a);'), false);
  assert.equal(ehLousa('┌── só o topo ──┐\n│ sem fundo'), false);
  assert.equal(ehLousa('┌┐'), false);
  assert.equal(ehLousa('api ──► banco\n└ fila'), false);
});

test('colunas contam caractere, não unidade UTF-16', () => {
  assert.equal(colunasDaLousa(LOUSA), 32);
});

test('o Ted fala a saudação e o desafio, nunca a lousa nem o emoji', () => {
  const trecho = trechoFalado(RESPOSTA_DO_TED);
  assert.equal(trecho, 'Uau, boa pergunta! Desafio: de que cor fica o céu no pôr do sol?');
  assert.ok(!trecho!.includes('luz'));
});

test('resposta só de lousa não tem o que falar', () => {
  assert.equal(trechoFalado(`\`\`\`\n${LOUSA}\n\`\`\``), null);
  assert.equal(trechoFalado('⚽ 🤔'), null);
});

test('corta em frase inteira no teto; frase gigante corta na palavra', () => {
  const longo = 'Primeira frase curta. Segunda frase também curta. Terceira frase que estoura o teto do trecho.';
  assert.equal(trechoFalado(longo, 50), 'Primeira frase curta. Segunda frase também curta.');
  assert.equal(trechoFalado('uma frase enorme sem ponto nenhum que não acaba', 20), 'uma frase enorme…');
});

test('marcação some: negrito, link, título, lista', () => {
  assert.equal(trechoFalado('## Oi\n**Muito** bem, [veja](https://x.y)!\n- item um'), 'Oi Muito bem, veja! item um');
});

test('perfil: frota não liga nada; cliente ganha o botão grande; só o Ted a lousa e a fala', () => {
  assert.deepEqual(perfilDo('frota', 'ted'), { botaoDeVozGrande: false, lousa: false, falaSozinha: false });
  assert.deepEqual(perfilDo('cliente', 'fred'), { botaoDeVozGrande: true, lousa: false, falaSozinha: false });
  assert.deepEqual(perfilDo('cliente', 'sofia'), { botaoDeVozGrande: true, lousa: false, falaSozinha: false });
  assert.deepEqual(perfilDo('cliente', 'ted'), { botaoDeVozGrande: true, lousa: true, falaSozinha: true });
  assert.deepEqual(perfilDo('cliente', undefined), { botaoDeVozGrande: true, lousa: false, falaSozinha: false });
});

test('o texto do `pre` sai do hast real do react-markdown e decide lousa × código', () => {
  const decide = (md: string) =>
    renderToStaticMarkup(
      createElement(ReactMarkdown, {
        components: { pre: ({ node }) => createElement('i', null, ehLousa(textoDoPre(node)) ? 'lousa' : 'codigo') },
        children: md,
      }),
    );
  assert.equal(decide(`\`\`\`\n${LOUSA}\n\`\`\``), '<i>lousa</i>');
  assert.equal(decide('```bash\ncurl -s x | jq .\n```'), '<i>codigo</i>');
  // Diagrama de duas caixas também fecha a moldura: por isso o PERFIL é a primeira porta.
  assert.equal(decide('```\n┌──┐     ┌──┐\n│a │ ──► │b │\n└──┘     └──┘\n```'), '<i>lousa</i>');
});
