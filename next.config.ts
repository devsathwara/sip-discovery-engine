import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ['@prisma/client', 'prisma', 'google-play-scraper']
};

export default nextConfig;
