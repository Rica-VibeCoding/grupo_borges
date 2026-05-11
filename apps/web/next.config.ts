import type { NextConfig } from 'next';

const API_BASE = process.env.API_BACKEND_URL ?? 'http://127.0.0.1:8000';

const config: NextConfig = {
  allowedDevOrigins: [
    '127.0.0.1',
    '127.0.0.1:3007',
    'localhost',
    'localhost:3007',
    '100.107.56.38',
    '100.107.56.38:3007',
    'srv1061129.tailfe77db.ts.net',
    'srv1061129.tailfe77db.ts.net:3007',
  ],
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_BASE}/api/:path*` }];
  },
};

export default config;
