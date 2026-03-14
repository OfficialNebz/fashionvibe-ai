import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        // Shopify product images — required for Next.js <Image> optimisation
        // Without this, all Shopify CDN images are blocked by Next.js
        protocol: 'https',
        hostname: 'cdn.shopify.com',
        pathname: '/**',
      },
    ],
  },
}

export default nextConfig
