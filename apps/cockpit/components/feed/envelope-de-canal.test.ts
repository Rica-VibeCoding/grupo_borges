import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ehVoz, leEnvelopeDeCanal, procedencia } from './envelope-de-canal.ts';

// Envelope real: o Rica mandou este vídeo em 15/08, com esse texto.
const COM_VIDEO =
  '<channel source="plugin:telegram:telegram" chat_id="7262275215" message_id="5548" ' +
  'user="Ricardo_nBorges" user_id="7262275215" ts="2026-08-15T12:56:42.000Z" ' +
  'attachment_kind="video" attachment_file_id="BAACAgEAAxkBAAIVrGqAYgo2" ' +
  'attachment_size="878824" attachment_mime="video/mp4" attachment_name="IMG_7751.MOV">' +
  'Olha que vergonha que dá quando olhamos para isso</channel>';

// Os dois formatos que o corpus do core já registrava (render-items.test.ts).
const WHATSAPP_AUDIO =
  '<channel source="whatsapp" user="Rica" attachment_kind="audio" attachment_path="/tmp/a.ogg">manda status</channel>';
const TELEGRAM_TEXTO = '<channel source="telegram" user="Daniel">texto do telegram</channel>';

test('leEnvelopeDeCanal — a bolha recebe o que a pessoa escreveu, não o XML', () => {
  const e = leEnvelopeDeCanal(COM_VIDEO);
  assert.ok(e);
  assert.equal(e.texto, 'Olha que vergonha que dá quando olhamos para isso');
  assert.equal(e.texto.includes('<channel'), false);
  assert.equal(e.texto.includes('chat_id'), false);
});

test('leEnvelopeDeCanal — anexo vira dado, com nome e tipo', () => {
  const e = leEnvelopeDeCanal(COM_VIDEO);
  assert.deepEqual(e?.anexo, { tipo: 'video', nome: 'IMG_7751.MOV', mime: 'video/mp4' });
});

test('leEnvelopeDeCanal — procedência sai do envelope, não do corpo', () => {
  const e = leEnvelopeDeCanal(COM_VIDEO);
  assert.equal(e?.autor, 'Ricardo_nBorges');
  assert.equal(e?.origem, 'plugin:telegram:telegram');
});

test('leEnvelopeDeCanal — envelope de texto puro não inventa anexo', () => {
  const e = leEnvelopeDeCanal(TELEGRAM_TEXTO);
  assert.equal(e?.texto, 'texto do telegram');
  assert.equal(e?.anexo, undefined);
  assert.equal(procedencia(e!), 'Telegram');
});

test('leEnvelopeDeCanal — áudio do WhatsApp mantém o tipo declarado', () => {
  const e = leEnvelopeDeCanal(WHATSAPP_AUDIO);
  assert.equal(e?.anexo?.tipo, 'audio');
  assert.equal(e?.texto, 'manda status');
});

test('leEnvelopeDeCanal — tipo cai pro mime quando o kind não veio', () => {
  const e = leEnvelopeDeCanal(
    '<channel source="telegram" attachment_mime="application/pdf">olha o contrato</channel>',
  );
  assert.equal(e?.anexo?.tipo, 'documento');
});

test('leEnvelopeDeCanal — texto que não é envelope devolve null, não meio-parse', () => {
  assert.equal(leEnvelopeDeCanal('mensagem normal do Rica'), null);
  assert.equal(leEnvelopeDeCanal('<channel sem source>oi</channel>'), null);
});

// O print do Rica de 15/08: a foto que ele mandou do celular virava a palavra
// literal `(photo)` no feed, porque ninguém lia o `image_path` do envelope.
test('leEnvelopeDeCanal — foto do Telegram traz o caminho e o tipo imagem', () => {
  const e = leEnvelopeDeCanal(
    '<channel source="plugin:telegram:telegram" user="Ricardo_nBorges"'
      + ' image_path="/home/clawd/.claude/channels/telegram/inbox/1786819933379-AQADeAxr.jpg">'
      + '(photo)</channel>',
  );
  assert.equal(e?.anexo?.tipo, 'image');
  assert.equal(
    e?.anexo?.caminho,
    '/home/clawd/.claude/channels/telegram/inbox/1786819933379-AQADeAxr.jpg',
  );
});

test('leEnvelopeDeCanal — anexo do WhatsApp traz o caminho pelo attachment_path', () => {
  const e = leEnvelopeDeCanal(
    '<channel source="whatsapp" attachment_kind="image"'
      + ' attachment_path="/home/clawd/.claude/channels/whatsapp/inbox/foto.png">olha</channel>',
  );
  assert.equal(e?.anexo?.caminho, '/home/clawd/.claude/channels/whatsapp/inbox/foto.png');
});

test('leEnvelopeDeCanal — envelope sem caminho não ganha campo vazio', () => {
  const e = leEnvelopeDeCanal(
    '<channel source="telegram" attachment_kind="audio">manda status</channel>',
  );
  assert.equal(e?.anexo?.caminho, undefined);
});

// O print do Rica de 28/09: o cabeçalho saía "PLUGIN:TELEGRAM:TELEGRAM ·
// RICARDO_NBO… voice (voice message)". O parser casava — o que vazava era o
// `source` cru, o `attachment_kind` cru e o corpo-marcador do plugin.
const TELEGRAM_VOZ =
  '<channel source="plugin:telegram:telegram" chat_id="7262275215" message_id="4857" '
  + 'user="Ricardo_nBorges" user_id="7262275215" ts="2026-07-28T04:10:21.000Z" '
  + 'attachment_kind="voice" attachment_file_id="AwACAgEAAxkB" attachment_size="96577" '
  + 'attachment_mime="audio/ogg">\n(voice message)\n</channel>';

test('procedencia — nome do canal legível, sem o source cru nem o usuário', () => {
  const e = leEnvelopeDeCanal(TELEGRAM_VOZ)!;
  assert.equal(procedencia(e), 'Telegram');
  assert.equal(procedencia(leEnvelopeDeCanal(WHATSAPP_AUDIO)!), 'WhatsApp');
});

test('leEnvelopeDeCanal — voz do Telegram: é voz, e o marcador do plugin não vira fala', () => {
  const e = leEnvelopeDeCanal(TELEGRAM_VOZ)!;
  assert.equal(ehVoz(e), true);
  assert.equal(e.texto, '');
  assert.equal(ehVoz(leEnvelopeDeCanal(WHATSAPP_AUDIO)!), true);
  assert.equal(ehVoz(leEnvelopeDeCanal(COM_VIDEO)!), false);
});
