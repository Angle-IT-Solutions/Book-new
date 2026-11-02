import { withPayload } from '@payloadcms/next/withPayload'
import type { NextConfig } from 'next'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(__filename)

const nextConfig: NextConfig = {
  webpack: (webpackConfig) => {
    webpackConfig.resolve.extensionAlias = {
      '.cjs': ['.cts', '.cjs'],
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    }

    return webpackConfig
  },
  turbopack: {
    root: path.resolve(dirname),
  },
  images: {
    loader: 'custom',
    loaderFile: './figma-image-loader.ts',
  },
  enablePrerenderSourceMaps: false,
  experimental: {
    cpus: 2,
  },
  env: {
    NEXT_PUBLIC_SITE_URL:
      process.env.NEXT_PUBLIC_SITE_URL || process.env.URL || 'http://localhost:3000',
    NEXT_PUBLIC_DIRECT_UPLOADS: process.env.NETLIFY === 'true' ? 'true' : 'false',
  },
}

export default withPayload(nextConfig, { devBundleServerPackages: false })
