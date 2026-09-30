import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const tela = readFileSync(new URL('./tela-conversa.tsx', import.meta.url), 'utf8');
const pager = readFileSync(new URL('./pager-do-agente.tsx', import.meta.url), 'utf8');
const entrada = readFileSync(new URL('../../app/conversa/[slug]/page.tsx', import.meta.url), 'utf8');

test('cabeçalho da voz é o acionador do painel; arrastar para cima não abre nada', () => {
  assert.match(tela, /<LinkAbrePainel[\s\S]*?<PilulaDoAgente[\s\S]*?<\/LinkAbrePainel>/);
  assert.doesNotMatch(tela, /aoConfiguracoes|<ConfiguracaoDaConversa/);
});

test('captura do paginador não trata links do cabeçalho de voz como troca de tela', () => {
  assert.match(pager, /chatRef\.current\?\.contains\(link\)/);
});

test('entrada direta da voz preserva a busca da gaveta na recarga', () => {
  assert.match(entrada, /await searchParams/);
  assert.match(entrada, /busca\.set\('tela', 'voz'\)/);
});
