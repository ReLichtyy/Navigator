"use client"

import { useSignIn } from "@clerk/nextjs"
import { useState } from "react"
import { Compass, Lock, Mail, ArrowLeft } from "lucide-react"
import { cn } from "@/lib/utils"
import { SignInForm } from "@/components/auth/sign-in-form"

export default function SignInPage() {
  const { isLoaded, signIn } = useSignIn()
  // Mobile: the brand panel is the cover; tapping "correo" reveals the form.
  const [mobileForm, setMobileForm] = useState(false)

  const googleLogin = async () => {
    if (!isLoaded) return
    try {
      await signIn.authenticateWithRedirect({
        strategy: "oauth_google",
        redirectUrl: "/sso-callback",
        redirectUrlComplete: "/",
      })
    } catch {
      /* surfaced inside the form flow */
    }
  }

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-[#080A09] font-sans text-foreground">
      {/* ===================== BRAND PANEL / mobile cover ===================== */}
      <aside
        className={cn(
          "relative w-full overflow-hidden border-accent/10 bg-[linear-gradient(165deg,#0c130f_0%,#080A09_60%)] lg:w-[46%] lg:min-w-[420px] lg:max-w-[560px] lg:border-r",
          mobileForm ? "hidden lg:flex" : "flex",
        )}
      >
        {/* ── decorations ── */}
        <div className="signin-glow-a pointer-events-none absolute -left-24 -top-32 h-[440px] w-[440px] rounded-full bg-[radial-gradient(circle,rgba(63,191,132,0.22),transparent_65%)] blur-2xl" />
        <div className="signin-glow-b pointer-events-none absolute -bottom-40 -right-20 h-[400px] w-[400px] rounded-full bg-[radial-gradient(circle,rgba(91,227,154,0.16),transparent_65%)] blur-2xl" />
        <div className="signin-glow-a pointer-events-none absolute right-8 top-1/3 h-[180px] w-[180px] rounded-full bg-[radial-gradient(circle,rgba(127,156,255,0.10),transparent_70%)] blur-2xl" />
        <div className="signin-drift pointer-events-none absolute -right-32 top-1/2 h-[520px] w-[520px] -translate-y-1/2 rounded-full opacity-[0.07] [background:conic-gradient(from_0deg,transparent,rgba(91,227,154,0.5),transparent_40%)]" />
        <div className="pointer-events-none absolute inset-0 opacity-50 [background-image:radial-gradient(rgba(255,255,255,0.035)_1px,transparent_1px)] [background-size:22px_22px]" />
        <div className="pointer-events-none absolute inset-0 [background:radial-gradient(120%_80%_at_50%_-10%,rgba(63,191,132,0.06),transparent_55%)]" />

        <div className="relative z-[2] flex h-full w-full flex-col p-8 sm:p-12">
          {/* brand */}
          <div className="flex items-center gap-3">
            <span className="flex h-[42px] w-[42px] items-center justify-center rounded-[13px] border border-accent/40 bg-[linear-gradient(150deg,#1c2a22,#0f1611)] text-accent shadow-[0_0_26px_rgba(63,191,132,0.18)]">
              <Compass className="h-[22px] w-[22px]" strokeWidth={1.9} />
            </span>
            <div className="flex flex-col leading-[1.05]">
              <span className="text-[18px] font-extrabold tracking-tight text-[#F2F6F4]">
                Navigator
              </span>
              <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#5C6661]">
                Study OS
              </span>
            </div>
          </div>

          {/* center message */}
          <div className="flex max-w-[400px] flex-1 flex-col justify-center">
            <div className="mb-6 inline-flex items-center gap-2 self-start rounded-full border border-accent/20 bg-accent/10 px-3 py-1.5">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent shadow-[0_0_8px_#5BE39A]" />
              <span className="text-[11.5px] font-semibold text-[#9FEDC4]">
                Tu copiloto de estudio
              </span>
            </div>
            <h1 className="text-[clamp(30px,7vw,38px)] font-extrabold leading-[1.1] tracking-tight text-[#F4F8F6] text-balance">
              Volvamos justo donde lo dejaste.
            </h1>
            <p className="mt-[18px] max-w-[340px] text-[15.5px] leading-relaxed text-[#9AA5A0]">
              Tus cursos, tarjetas y mapas mentales te esperan. Inicia sesión y sigamos construyendo
              tu racha. 🔥
            </p>

            {/* mini stat cards */}
            <div className="mt-[34px] flex gap-3">
              <div className="flex-1 rounded-[15px] border border-accent/[0.16] bg-[linear-gradient(160deg,rgba(63,191,132,0.10),rgba(63,191,132,0.02))] px-4 py-[15px]">
                <div className="font-mono text-[23px] font-bold tracking-tight text-[#9FEDC4]">
                  6
                </div>
                <div className="mt-0.5 text-[11.5px] text-[#7C8983]">días de racha</div>
              </div>
              <div className="flex-1 rounded-[15px] border border-white/[0.07] bg-white/[0.025] px-4 py-[15px]">
                <div className="font-mono text-[23px] font-bold tracking-tight text-[#E8EDEA]">
                  128
                </div>
                <div className="mt-0.5 text-[11.5px] text-[#7C8983]">tarjetas repasadas</div>
              </div>
            </div>
          </div>

          {/* ── mobile CTA buttons (cover) ── */}
          <div className="flex flex-col gap-3 lg:hidden">
            <button
              type="button"
              onClick={googleLogin}
              className="flex h-[52px] w-full items-center justify-center gap-2.5 rounded-[14px] bg-white text-[14.5px] font-semibold text-[#1a1a1a] transition-transform active:scale-[0.98]"
            >
              <svg width="19" height="19" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"
                />
              </svg>
              Iniciar sesión con Google
            </button>
            <button
              type="button"
              onClick={() => setMobileForm(true)}
              className="flex h-[52px] w-full items-center justify-center gap-2.5 rounded-[14px] border border-white/15 bg-white/[0.03] text-[14.5px] font-semibold text-[#E8EDEA] transition-colors active:bg-white/[0.07]"
            >
              <Mail className="h-[18px] w-[18px]" strokeWidth={1.9} />
              Iniciar sesión con correo
            </button>
          </div>

          {/* footer (desktop) */}
          <div className="hidden items-center gap-2.5 text-[12px] text-[#5C6661] lg:flex">
            <Lock className="h-3.5 w-3.5" strokeWidth={2} />
            <span>Inicio de sesión seguro · cifrado de extremo a extremo</span>
          </div>
        </div>
      </aside>

      {/* ===================== FORM PANEL ===================== */}
      <main
        className={cn(
          "relative flex-1 items-center justify-center bg-[radial-gradient(900px_480px_at_50%_-10%,rgba(63,191,132,0.05),transparent_60%),#0A0C0B] px-7 py-10",
          mobileForm ? "flex" : "hidden lg:flex",
        )}
      >
        <div className="w-full max-w-[392px]">
          {/* mobile: back to the cover */}
          <button
            type="button"
            onClick={() => setMobileForm(false)}
            className="mb-6 inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#8A938E] transition-colors hover:text-[#C9D2CD] lg:hidden"
          >
            <ArrowLeft className="h-[15px] w-[15px]" strokeWidth={2.2} />
            Volver
          </button>

          <SignInForm />
        </div>
      </main>
    </div>
  )
}
