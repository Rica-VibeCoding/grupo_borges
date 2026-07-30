import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { normalizeThinkingContent } from './thinking.ts';

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

test('extrai corpo não vazio do representante real de thinking', () => {
  const fixture = loadFixture('bloco__thinking');
  const content = fixture.evento.message?.content;
  assert.ok(Array.isArray(content));

  const thinkingPart = content.find(
    (part): part is { type: 'thinking'; thinking: string } =>
      typeof part === 'object' &&
      part !== null &&
      (part as Record<string, unknown>).type === 'thinking' &&
      typeof (part as Record<string, unknown>).thinking === 'string',
  );
  assert.ok(thinkingPart);

  assert.equal(fixture.ocorrencias, 804);
  assert.match(
    thinkingPart.thinking,
    /^<texto redigido · 73238 chars · 388 linhas>\n<linha redigida>/,
  );
  assert.deepEqual(normalizeThinkingContent(content), {
    text: thinkingPart.thinking,
    lineCount: 388,
  });
});

test('content null real vira cabeçalho vazio, sem corpo expansível', () => {
  const fixture = loadFixture('borda__content_none');
  const content = fixture.evento.message?.content ?? null;

  assert.equal(fixture.ocorrencias, 199);
  assert.equal(fixture.evento.message, null);
  assert.equal(content, null);
  assert.deepEqual(normalizeThinkingContent(content), {
    text: '',
    lineCount: 0,
  });
});

test('content string real vira um único corpo de uma linha', () => {
  const fixture = loadFixture('borda__content_string');
  const content = fixture.evento.message?.content;
  assert.equal(typeof content, 'string');

  assert.equal(fixture.ocorrencias, 87);
  assert.deepEqual(normalizeThinkingContent(content), {
    text: content,
    lineCount: 1,
  });
});

test('conta quebras CRLF e ignora quebra vazia no fim', () => {
  const content = 'primeira linha\r\nsegunda linha\n';

  assert.deepEqual(normalizeThinkingContent(content), {
    text: content,
    lineCount: 2,
  });
});
