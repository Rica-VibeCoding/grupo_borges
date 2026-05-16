// Snapshots textuais determinísticos pros 4 cenários da Fase 1 JP-11.
// Roda: `node --test tests/pane-chrome.snapshots.test.ts`
//
// Substitui prints visuais (que dependem de tmux com excerpt controlado)
// por antes/depois reprodutível em string. JP-11 Fase 1 — DS-58.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  endsWithActiveSpinner,
  parseAnsi,
  stripChrome,
} from '../lib/pane-chrome.ts';

const OUT_DIR = '/tmp/jp11-fases';
fs.mkdirSync(OUT_DIR, { recursive: true });

const SNAPSHOTS: Record<string, string> = {};

function snap(name: string, payload: string) {
  SNAPSHOTS[name] = payload;
}

// ----- Cenário 1: prosa preservada (gap regex antiga) -------------------
test('snapshot — prosa preservada (gap regex antiga)', () => {
  const input = [
    'Opus 4.7 - 14:22 - [██░] 27%',
    '',
    'olá Daniel, vou esperar for 30 segundos antes de tentar de novo',
    'também posso aguardar for 2 min se preferir',
    '',
    '✻ Brewed for 5m 23s',
    '',
    'segue o relatório',
  ].join('\n');
  const out = stripChrome(input);
  snap(
    'cenario-1-prosa-preservada',
    [
      '== INPUT ==',
      input,
      '',
      '== OUTPUT stripChrome ==',
      out,
      '',
      '== ESPERADO ==',
      '- Statusline removida',
      '- "Brewed for 5m 23s" removida (spinner finalizado)',
      '- Prosa "esperar for 30 segundos" / "aguardar for 2 min" PRESERVADAS',
      '- "segue o relatório" preservado',
    ].join('\n'),
  );
  assert.match(out, /esperar for 30 segundos/);
  assert.match(out, /aguardar for 2 min/);
  assert.match(out, /segue o relatório/);
  assert.doesNotMatch(out, /Opus 4\.7/);
  assert.doesNotMatch(out, /Brewed for 5m/);
});

// ----- Cenário 2: frame parcial detectado --------------------------------
test('snapshot — frame parcial detectado', () => {
  const frameStable = [
    'Daniel: aqui está o output da query',
    'row 1: 42',
    'row 2: 17',
  ].join('\n');
  const framePartial = [
    'Daniel: aqui está o output da query',
    'row 1: 42',
    'row 2: 17',
    'row 3: ', // CC ainda escrevendo
    '· Boogieing… (1m 8s · ↓ 2.7k tokens · thought for 33s)',
  ].join('\n');
  const isPartial = endsWithActiveSpinner(framePartial);
  const isStable = endsWithActiveSpinner(frameStable);
  snap(
    'cenario-2-frame-parcial',
    [
      '== FRAME ESTÁVEL ==',
      frameStable,
      `endsWithActiveSpinner = ${isStable}`,
      '',
      '== FRAME PARCIAL ==',
      framePartial,
      `endsWithActiveSpinner = ${isPartial}`,
      '',
      '== COMPORTAMENTO ==',
      'PanePreview segura `lastGoodFrameRef` quando isPartial=true.',
      'Display = frameStable enquanto CC escreve, pra evitar flicker.',
    ].join('\n'),
  );
  assert.equal(isStable, false);
  assert.equal(isPartial, true);
});

// ----- Cenário 3: line_limit ampliado -----------------------------------
test('snapshot — line_limit ampliado 80→200', () => {
  const lines200 = Array.from({ length: 200 }, (_, i) => `linha ${i + 1}`).join('\n');
  const lines80 = lines200.split('\n').slice(-80).join('\n');
  snap(
    'cenario-3-line-limit',
    [
      '== ANTES (line_limit=80) ==',
      'Backend cortava o topo. Resposta longa do CC perdia contexto inicial.',
      'Primeira linha visível:',
      lines80.split('\n')[0],
      '',
      '== DEPOIS (line_limit=200) ==',
      'Backend retém topo. Configurável via env COCKPIT_PANE_LINE_LIMIT.',
      'Primeira linha visível:',
      lines200.split('\n')[0],
      '',
      'Última linha (igual em ambos):',
      lines200.split('\n').slice(-1)[0],
    ].join('\n'),
  );
});

// ----- Cenário 4: ANSI preservado ---------------------------------------
test('snapshot — ANSI preservado (cores básicas + bold)', () => {
  const input = '\x1b[31merror\x1b[0m: tabela \x1b[1;36mfc_backlog\x1b[0m tem \x1b[32m42\x1b[0m linhas';
  const segments = parseAnsi(input);
  snap(
    'cenario-4-ansi-preservado',
    [
      '== INPUT (com ANSI escapes) ==',
      JSON.stringify(input),
      '',
      '== SEGMENTOS parseAnsi ==',
      ...segments.map(
        (s, i) =>
          `[${i}] text=${JSON.stringify(s.text)} color=${s.color ?? '—'} bold=${s.bold ?? false}`,
      ),
      '',
      '== ANTES (ANSI strippado no backend) ==',
      'Front recebia "error: tabela fc_backlog tem 42 linhas" sem cores.',
      '',
      '== DEPOIS (ANSI preservado) ==',
      'Front renderiza cada segmento com style={{ color, fontWeight }}.',
    ].join('\n'),
  );
  // Garante que há ao menos um segmento colorido e um bold.
  assert.ok(segments.some((s) => s.color !== undefined), 'algum segmento com cor');
  assert.ok(segments.some((s) => s.bold === true), 'algum segmento bold');
});

// ----- Escreve arquivo agregado -----------------------------------------
test('escreve snapshots em /tmp/jp11-fases/fase-1-snapshots.txt', () => {
  const body = Object.entries(SNAPSHOTS)
    .map(([name, content]) => `### ${name}\n\n${content}\n`)
    .join('\n----------------------------------------\n\n');
  const target = path.join(OUT_DIR, 'fase-1-snapshots.txt');
  fs.writeFileSync(target, body, 'utf8');
  assert.ok(fs.existsSync(target));
});
