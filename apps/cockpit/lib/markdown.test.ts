import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mergeMarkdownClassName,
  transformMarkdownUrl,
} from './markdown.ts';

test('preserva URLs web absolutas', () => {
  assert.equal(
    transformMarkdownUrl('https://example.com/docs?q=cockpit'),
    'https://example.com/docs?q=cockpit',
  );
});

test('preserva links relativos e fragmentos', () => {
  assert.equal(transformMarkdownUrl('/agentes/daniel'), '/agentes/daniel');
  assert.equal(transformMarkdownUrl('#resultado'), '#resultado');
});

test('preserva links de email', () => {
  assert.equal(transformMarkdownUrl('mailto:rica@example.com'), 'mailto:rica@example.com');
});

test('bloqueia javascript em links', () => {
  assert.equal(transformMarkdownUrl('javascript:alert(1)'), '');
  assert.equal(transformMarkdownUrl('JaVaScRiPt:alert(1)'), '');
});

test('bloqueia data URLs em imagens markdown', () => {
  assert.equal(transformMarkdownUrl('data:image/png;base64,AAAA'), '');
});

test('bloqueia outros protocolos que a política padrão não reconhece', () => {
  assert.equal(transformMarkdownUrl('vbscript:msgbox(1)'), '');
  assert.equal(transformMarkdownUrl('tel:+5511999999999'), '');
});

test('preserva URL relativa a protocolo', () => {
  assert.equal(transformMarkdownUrl('//cdn.example.com/image.png'), '//cdn.example.com/image.png');
});

test('preserva classes semânticas produzidas pelo parser GFM', () => {
  assert.equal(
    mergeMarkdownClassName('font-mono text-[13px]', 'language-typescript'),
    'font-mono text-[13px] language-typescript',
  );
  assert.equal(mergeMarkdownClassName('list-disc'), 'list-disc');
});
