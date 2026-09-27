import { copyFile, mkdir, stat } from 'node:fs/promises';
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

await mkdir(destino, { recursive: true });

let total = 0;
for (const [origem, nome] of arquivos) {
  await copyFile(origem, join(destino, nome));
  total += (await stat(origem)).size;
}

console.log(`VAD: ${arquivos.length} arquivos copiados para public/vad (${(total / 1_048_576).toFixed(1)} MB)`);
