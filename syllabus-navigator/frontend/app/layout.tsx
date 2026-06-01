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

import { auth } from "@/lib/auth/auth"

import { AppSidebar } from "@/components/navigator/app-sidebar"

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const session = await auth()

  return (
    <html lang="es" className={`${geist.variable} ${geistMono.variable} bg-background`}>
      <body className="font-sans antialiased flex h-dvh w-full overflow-hidden text-foreground">
        <ClientProviders session={session}>
          <AppSidebar />
          <div className="flex-1 flex flex-col min-w-0">
            {children}
          </div>
        </ClientProviders>
      </body>
    </html>
  )
}
