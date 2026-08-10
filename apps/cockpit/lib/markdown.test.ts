import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import {
  ALERT_KINDS,
  mergeMarkdownClassName,
  normalizeMarkdownContent,
  remarkCockpitAlerts,
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

// --- alerts -------------------------------------------------------------
// Atravessam o pipeline REAL (react-markdown + remark-gfm), não uma árvore
// montada à mão: o que precisa ser provado é justamente que o `hProperties`
// sobrevive à conversão pra hast e chega como prop no componente.

function renderMarkdown(markdown: string): string {
  return renderToStaticMarkup(
    createElement(
      ReactMarkdown,
      { remarkPlugins: [remarkGfm, remarkCockpitAlerts] },
      markdown,
    ),
  );
}

test('cada um dos cinco alerts vira data-alert e perde o marcador literal', () => {
  for (const kind of ALERT_KINDS) {
    const html = renderMarkdown(`> [!${kind.toUpperCase()}]\n> Corpo do aviso.`);

    assert.match(html, new RegExp(`data-alert="${kind}"`));
    assert.equal(html.includes('[!'), false, `marcador vazou em ${kind}: ${html}`);
    assert.match(html, /Corpo do aviso\./);
  }
});

test('marcador em minúscula também pega — quem escreve é LLM', () => {
  const html = renderMarkdown('> [!caution]\n> Some com tudo.');
  assert.match(html, /data-alert="caution"/);
  assert.equal(html.includes('[!'), false);
});

test('citação comum continua citação, sem data-alert', () => {
  const html = renderMarkdown('> "não quero relatório longo"');
  assert.equal(html.includes('data-alert'), false);
  assert.match(html, /<blockquote>/);
});

test('citação que MENCIONA o marcador no meio não vira alerta', () => {
  const html = renderMarkdown('> o Rica falou de [!NOTE] ontem');
  assert.equal(html.includes('data-alert'), false);
  assert.match(html, /\[!NOTE\]/);
});

test('marcador seguido de linha em branco não deixa parágrafo vazio', () => {
  const html = renderMarkdown('> [!NOTE]\n>\n> Corpo.');
  assert.match(html, /data-alert="note"/);
  assert.equal(html.includes('<p></p>'), false, html);
});

test('marcador com quebra dura não deixa <br> órfão no topo', () => {
  const html = renderMarkdown('> [!NOTE]  \n> Corpo.');
  assert.match(html, /data-alert="note"/);
  assert.equal(html.includes('<p><br/>'), false, html);
});

test('formatação depois do marcador sobrevive', () => {
  const html = renderMarkdown('> [!WARNING]\n> **cuidado** com isso');
  assert.match(html, /data-alert="warning"/);
  assert.match(html, /<strong>cuidado<\/strong>/);
  assert.equal(html.includes('[!'), false);
});

test('alerta dentro de item de lista também é marcado', () => {
  const html = renderMarkdown('- item\n\n  > [!TIP]\n  > dica aninhada');
  assert.match(html, /data-alert="tip"/);
  assert.equal(html.includes('[!'), false);
});
