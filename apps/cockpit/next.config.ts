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
