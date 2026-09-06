import { execFileSync, execSync } from 'node:child_process';
import type { NextConfig } from 'next';
import { PHASE_PRODUCTION_BUILD } from 'next/constants.js';

// 8002 e NÃO 8000 — a 8000 desta VPS é do Coolify. O destino do rewrite é
// gravado no `.next/routes-manifest.json` NA COMPILAÇÃO, então um `next build`
// sem `API_BACKEND_URL` exportado publica o front inteiro apontando pro lugar
// errado, com o build verde. Mesma armadilha do `apps/cockpit/next.config.ts`.
const API_BASE = process.env.API_BACKEND_URL ?? 'http://127.0.0.1:8002';

/**
 * A falha barulhenta do build — gêmea da de `apps/cockpit/next.config.ts`, onde
 * mora o porquê inteiro. Em resumo: a régua é o CORPO da resposta, porque o
 * endereço errado (Coolify) também responde de pé.
 */
function exigeBackendVivo(base: string): void {
  if (process.env.COCKPIT_BUILD_SEM_BACKEND === '1') return;

  const alvo = `${base}/health`;
  const origem = process.env.API_BACKEND_URL ? 'API_BACKEND_URL' : 'default deste arquivo';
  const comoConsertar =
    `  Endereço em uso: ${base}  (${origem})\n` +
    `  É ele que vai ser gravado no rewrite do bundle.\n\n` +
    `  Conferir a API:  systemctl --user status cockpit-api.service\n` +
    `  Build sem back:  COCKPIT_BUILD_SEM_BACKEND=1 pnpm build\n`;

  let corpo: string;
  try {
    corpo = execFileSync('curl', ['-fsS', '--max-time', '5', alvo], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    throw new Error(`\n\n  BUILD ABORTADO — ${alvo} não respondeu.\n\n${comoConsertar}`);
  }

  if (!corpo.includes('grupo_borges-api')) {
    throw new Error(
      `\n\n  BUILD ABORTADO — ${alvo} respondeu, mas NÃO é a nossa API.\n` +
        `  (devolveu: ${corpo.slice(0, 120).replace(/\s+/g, ' ').trim()})\n\n${comoConsertar}`,
    );
  }
}

function getDeploymentId(): string | undefined {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return undefined;
  }
}

const config: NextConfig = {
  deploymentId: getDeploymentId(),
  devIndicators: false,
  allowedDevOrigins: [
    '127.0.0.1',
    'localhost',
    '*.tailfe77db.ts.net',
    '100.107.56.38',
  ],
  // SSE quebra em rewrites() quando o servidor Node de dev aplica gzip:
  // chunks pequenos ficam presos no decoder do browser, então o cliente
  // vê o replay inicial em rajada e nunca recebe heartbeat/live. Vercel
  // edge tem compressão própria, então isso só desliga em dev/self-host.
  compress: false,
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${API_BASE}/api/:path*` },
      { source: '/uploads/agents/:path*', destination: `${API_BASE}/uploads/agents/:path*` },
    ];
  },
};

// Só no `next build`: em `next start`, uma API momentaneamente fora do ar viraria
// front que não sobe. Ver `apps/cockpit/next.config.ts`.
export default (phase: string): NextConfig => {
  if (phase === PHASE_PRODUCTION_BUILD) exigeBackendVivo(API_BASE);
  return config;
};
