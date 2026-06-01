import type { Metadata } from "next"
import { Inter, Roboto_Mono } from "next/font/google"
import "./globals.css"
import ClientProviders from "@/components/ClientProviders"

const geist = Inter({
  subsets: ["latin"],
  variable: "--font-geist",
})
const geistMono = Roboto_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
})

export const metadata: Metadata = {
  title: "Navigator — Your AI Assistant",
  description: "A minimalist AI assistant that helps you navigate documents, ideas, and answers.",
  generator: "v0.app",
}

import { auth } from "@/lib/auth/config"

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const session = await auth()

  return (
    <html lang="es" className={`${geist.variable} ${geistMono.variable} bg-background`}>
      <body className="font-sans antialiased">
        <ClientProviders session={session}>{children}</ClientProviders>
      </body>
    </html>
  )
}
