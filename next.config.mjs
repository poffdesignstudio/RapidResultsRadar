/** @type {import('next').NextConfig} */
const nextConfig = {
  // Loaded from node_modules at run time instead of bundled (ESM and WebAssembly packages).
  serverExternalPackages: ['hyparquet', 'hyparquet-compressors', 'cheerio', 'robots-parser', 'postgres', 'fflate'],
  webpack: (config) => {
    // The Stage 1 code imports "./x.js" for "./x.ts" (Node style); let webpack find the .ts file.
    config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] }
    return config
  },
}
export default nextConfig
