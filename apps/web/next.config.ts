import type { NextConfig } from 'next';

const API_BASE = process.env.API_BACKEND_URL ?? 'http://127.0.0.1:8000';

const config: NextConfig = {
  allowedDevOrigins: [
    '127.0.0.1',
    'localhost',
    '*.tailfe77db.ts.net',
    '100.107.56.38',
  ],
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_BASE}/api/:path*` }];
  },
};

export default config;
