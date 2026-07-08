import { ClerkProvider } from "@clerk/nextjs"
import { dark } from "@clerk/themes"
import type { Metadata, Viewport } from "next"
import { Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google"
import "./globals.css"
import ClientProviders from "@/components/ClientProviders"

// Navigator.dc.html typefaces
const geist = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-geist",
})
const geistMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-geist-mono",
})

export const metadata: Metadata = {
  title: "Navigator — Your AI Assistant",
  description: "A minimalist AI assistant that helps you navigate documents, ideas, and answers.",
  generator: "v0.app",
}

// Mobile: cover the notch/home-indicator area and let the on-screen keyboard
// resize the layout so the bottom-pinned chat composer stays above it.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
}

import { AppSidebar } from "@/components/navigator/app-sidebar"

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="es"
      className={`dark ${geist.variable} ${geistMono.variable} bg-background`}
      suppressHydrationWarning
    >
      <body className="font-sans antialiased flex h-dvh w-full overflow-hidden text-foreground">
        {/* Anti-FOUC: apply the persisted theme (localStorage "nav-theme",
            mirrored from user_preferences.theme) before anything paints.
            Default stays dark — the SSR class above — so first-ever loads and
            storage failures look like the original app. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("nav-theme")||"dark";var d=t==="dark"||(t==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);}catch(e){}})();`,
          }}
        />
        <ClerkProvider appearance={{ baseTheme: dark }}>
          <ClientProviders>
            <AppSidebar />
            <div className="flex-1 flex flex-col min-w-0">{children}</div>
          </ClientProviders>
        </ClerkProvider>
      </body>
    </html>
  )
}
