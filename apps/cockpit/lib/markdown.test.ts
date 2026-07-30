import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  mergeMarkdownClassName,
  normalizeMarkdownContent,
  transformMarkdownUrl,
} from './markdown.ts';

type Fixture = {
  familia: string;
  ocorrencias: number;
  evento: {
    message: {
      content: unknown;
    } | null;
  };
};

const FIXTURE_DIR = join(import.meta.dirname, '../../../fixtures/cockpit-v2/familias');

function loadFixture(name: string): Fixture {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, `${name}.json`), 'utf8')) as Fixture;
}

test('extrai texto do content array real', () => {
  const fixture = loadFixture('bloco__text');
  const content = fixture.evento.message?.content;
  assert.ok(Array.isArray(content));

  const textPart = content.find(
    (part): part is { type: 'text'; text: string } =>
      typeof part === 'object' &&
      part !== null &&
      (part as Record<string, unknown>).type === 'text' &&
      typeof (part as Record<string, unknown>).text === 'string',
  );
  assert.ok(textPart);

  assert.equal(fixture.ocorrencias, 330);
  assert.equal(normalizeMarkdownContent(content), textPart.text);
});

test('content null real vira ausência, sem depender do react-markdown', () => {
  const fixture = loadFixture('borda__content_none');
  const content = fixture.evento.message?.content ?? null;

  assert.equal(fixture.ocorrencias, 199);
  assert.equal(content, null);
  assert.equal(normalizeMarkdownContent(content), null);
});

test('content string real atravessa como um único corpo', () => {
  const fixture = loadFixture('borda__content_string');
  const content = fixture.evento.message?.content;
  assert.equal(typeof content, 'string');

  assert.equal(fixture.ocorrencias, 87);
  assert.equal(normalizeMarkdownContent(content), content);
});

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
