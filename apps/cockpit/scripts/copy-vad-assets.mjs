import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const destino = join(appDir, 'public', 'vad');
const vadPackage = require.resolve('@ricky0123/vad-web/package.json');
const vadDist = join(dirname(vadPackage), 'dist');
const requireDoVad = createRequire(vadPackage);
const ortDist = dirname(requireDoVad.resolve('onnxruntime-web/wasm'));

const arquivos = [
  [join(vadDist, 'vad.worklet.bundle.min.js'), 'vad.worklet.bundle.min.js'],
  [join(vadDist, 'silero_vad_v5.onnx'), 'silero_vad_v5.onnx'],
  [join(ortDist, 'ort-wasm-simd-threaded.mjs'), 'ort-wasm-simd-threaded.mjs'],
  [join(ortDist, 'ort-wasm-simd-threaded.wasm'), 'ort-wasm-simd-threaded.wasm'],
];

// ARQUIVO IGUAL NÃO SE RECOPIA. O `next start` serve o public/ com ETag fraco
// de tamanho+mtime e `max-age=0`: todo `copyFile` dá mtime novo, o ETag muda e
// o iPhone baixa de novo os 16,5 MB da voz (o .wasm sozinho tem 14,2) na
// primeira entrada depois de CADA build — este script roda no prebuild. Pular
// o idêntico mantém o mtime e o 304; pacote novo do VAD tem bytes diferentes e
// é copiado, com mtime e ETag novos.
async function mesmoConteudo(origem, alvo) {
  const [a, b] = await Promise.all([stat(origem), stat(alvo).catch(() => null)]);
  if (!b || a.size !== b.size) return false;
  const [x, y] = await Promise.all([readFile(origem), readFile(alvo)]);
  return x.equals(y);
}

await mkdir(destino, { recursive: true });

let total = 0;
let copiados = 0;
for (const [origem, nome] of arquivos) {
  const alvo = join(destino, nome);
  if (!(await mesmoConteudo(origem, alvo))) {
    await copyFile(origem, alvo);
    copiados++;
  }
  total += (await stat(origem)).size;
}

console.log(
  `VAD: ${copiados} de ${arquivos.length} arquivos copiados para public/vad (${(total / 1_048_576).toFixed(1)} MB; iguais ficam intocados)`,
);
