import type { NextConfig } from 'next';

const appOrigin = process.env.APP_ORIGIN;
const allowedOrigins = appOrigin ? [new URL(appOrigin).host] : undefined;

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '256kb',
      ...(allowedOrigins ? { allowedOrigins } : {}),
    },
  },
};

export default nextConfig;
