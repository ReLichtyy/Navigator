/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Evita que webpack intente bundlear módulos de Postgres en el cliente.
  // @neondatabase/serverless y drivers similares son server-only.
  webpack(config, { isServer }) {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        // Node.js built-ins que no existen en el browser
        fs: false,
        net: false,
        tls: false,
        dns: false,
        "pg-native": false,
      }
    }
    return config
  },
}

module.exports = nextConfig
