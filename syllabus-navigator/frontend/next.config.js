const isDev = process.env.NODE_ENV !== "production"

// Content-Security-Policy. Next.js injects inline bootstrap scripts (no nonce
// pipeline here) so 'unsafe-inline' stays; 'unsafe-eval' only in dev (webpack HMR).
// Clerk needs its script/frame/connect origins + Cloudflare Turnstile.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} https://*.clerk.accounts.dev https://*.clerk.com https://challenges.cloudflare.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://img.clerk.com",
  "font-src 'self' data:",
  // Vercel Blob client upload (@vercel/blob v2): the browser handshakes with the
  // API at https://vercel.com/api/blob, then transfers to the store hosts
  // (blob.vercel-storage.com apex + *.public.blob… read subdomains). All three
  // must be allowed or the browser CSP-blocks the upload and it hangs forever.
  "connect-src 'self' https://*.clerk.accounts.dev https://*.clerk.com https://clerk-telemetry.com https://vercel.com https://blob.vercel-storage.com https://*.blob.vercel-storage.com https://*.private.blob.vercel-storage.com https://*.public.blob.vercel-storage.com" +
    (isDev ? " ws: wss:" : ""),
  "worker-src 'self' blob:",
  "frame-src https://challenges.cloudflare.com https://*.clerk.accounts.dev https://*.clerk.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ")

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  // Redundant with frame-ancestors, kept for older agents.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  ...(isDev
    ? []
    : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // No delatar el framework en cada respuesta (X-Powered-By).
  poweredByHeader: false,

  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        // API: nunca cachear respuestas (datos por-usuario) ni indexarlas.
        source: "/api/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, max-age=0" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ]
  },

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

    // Ignore harmless edge runtime warning about jose's CompressionStream
    config.ignoreWarnings = [
      { module: /node_modules\/jose/ },
    ]

    return config
  },
}

module.exports = nextConfig
