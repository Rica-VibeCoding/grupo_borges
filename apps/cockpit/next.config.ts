import type { NextConfig } from 'next';

const API_BASE = process.env.API_BACKEND_URL ?? 'http://127.0.0.1:8000';

const config: NextConfig = {
  devIndicators: false,

  // ⚠️ O DEV NÃO DIVIDE DIRETÓRIO DE BUILD COM A PRODUÇÃO. O `next start` da
  // 3008 roda a partir deste mesmo `apps/cockpit` e serve `.next/`; um
  // `next dev` apontado pra cá — ou uma faxina de `.next` pra destravar o
  // Turbopack — deixa a produção devolvendo 500 em todo chunk estático, com o
  // HTML ainda em 200 (o servidor já está em memória). Foi assim que a 3008 caiu
  // em 04/08. Dev sobe com `COCKPIT_DIST_DIR=.next-dev`; a produção não define a
  // variável e continua em `.next`.
  distDir: process.env.COCKPIT_DIST_DIR ?? '.next',

  // O core é consumido como SOURCE (subpath exports apontando pra .ts), sem build
  // step. É isto que transpila.
  transpilePackages: ['@grupo_borges/cockpit-core'],

  allowedDevOrigins: [
    '127.0.0.1',
    'localhost',
    '*.tailfe77db.ts.net',
    '100.107.56.38',
  ],

  // ⚠️ NÃO REMOVER. SSE quebra em rewrites() quando o servidor Node de dev aplica
  // gzip: os chunks pequenos ficam presos no decoder do browser. E o sintoma não é
  // erro — o cliente vê o replay inicial em rajada e nunca recebe heartbeat nem
  // live. Quem tirar esta linha vai depurar EventSource por horas procurando bug
  // de protocolo onde há bug de compressão. Herdado do apps/web, ver
  // docs/cockpit-v2-stack.md §4.
  compress: false,

  // ⚠️ O TETO DE 100MB DO VÍDEO MORA AQUI TAMBÉM, não só no backend. O Next
  // BUFFERIZA o corpo da requisição quando faz proxy, e o default é 10MB: acima
  // disso ele trunca, loga "Request body exceeded 10MB" e o FastAPI recebe um
  // multipart cortado — o socket cai (`ECONNRESET`) e o cliente vê 500. Sem esta
  // linha o teto de 100MB da rota `/file` é ficção: foto e documento passam
  // porque cabem em 10MB, vídeo de celular nunca passa. Foi o que travou o Rica
  // em 04/08 com um .mov do iPhone.
  //
  // O nome é `proxyClientMaxBodySize`. O `middlewareClientMaxBodySize` que a
  // mensagem de erro do Next sugere está DEPRECADO nesta versão (16.2.6) e os
  // dois juntos lançam E879 — conferido no `config.js:162` e `:616` da própria
  // instalação, além da doc.
  //
  // 60MB, e o número tem dono: o Next bufferiza o corpo INTEIRO em memória para
  // permitir múltiplas leituras, e o limite é POR REQUISIÇÃO, não global. Esta
  // VPS tem 7GB e já travou por consumo — 100MB aqui seriam 200MB de buffer com
  // dois uploads ao mesmo tempo. Por isso o teto de vídeo do backend caiu para
  // 50MB (`agents.py`, `_VIDEO_MAX_BYTES`) e a folga de 10MB cobre as bordas e a
  // legenda do multipart.
  //
  // TRÊS NÚMEROS ANDAM JUNTOS: este, o `_VIDEO_MAX_BYTES` do backend e o
  // `tetoBytes` de `lib/anexo.ts`. Mexer em um sozinho recria o bug de 04/08 —
  // a tela prometendo tamanho que o transporte não entrega.
  experimental: {
    proxyClientMaxBodySize: '60mb',
  },

  // O front não fala com o FastAPI por URL absoluta: chama /api/... no próprio
  // host e o Next faz o proxy. É isso que faz o SSE atravessar o Tailscale sem
  // CORS e sem porta extra exposta.
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${API_BASE}/api/:path*` },
      { source: '/uploads/agents/:path*', destination: `${API_BASE}/uploads/agents/:path*` },
    ];
  },
};

export default config;
