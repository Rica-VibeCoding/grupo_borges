import type { NextConfig } from 'next';

const API_BASE = process.env.API_BACKEND_URL ?? 'http://127.0.0.1:8000';

const config: NextConfig = {
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_BASE}/api/:path*` }];
  },
};

export default config;
