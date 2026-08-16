import { execSync } from 'node:child_process';
import type { NextConfig } from 'next';

const API_BASE = process.env.API_BACKEND_URL ?? 'http://127.0.0.1:8000';

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

export default config;
