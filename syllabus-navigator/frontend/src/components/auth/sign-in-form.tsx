"use client"

/**
 * sign-in-form.tsx — custom login UI (Login.dc.html design) wired to Clerk's
 * `useSignIn` hook. Three steps: email → 6-digit email code → success. Google
 * OAuth via redirect (/sso-callback). Replaces the default <SignIn/> widget.
 */

import { useSignIn } from "@clerk/nextjs"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useRef, useState } from "react"
import { Mail, ArrowRight, ArrowLeft, AlertCircle, Check, Loader2 } from "lucide-react"

type Step = "email" | "code" | "success"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function clerkError(e: unknown, fallback: string): string {
  const err = e as { errors?: { message?: string; longMessage?: string }[] }
  return err?.errors?.[0]?.longMessage || err?.errors?.[0]?.message || fallback
}

function nameFromEmail(email: string): string {
  const local = (email.split("@")[0] || "estudiante").replace(/[._-]+/g, " ").trim()
  return (
    local
      .split(" ")
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ") || "Estudiante"
  )
}

export function SignInForm() {
  const { isLoaded, signIn, setActive } = useSignIn()
  const router = useRouter()

  const [step, setStep] = useState<Step>("email")
  const [email, setEmail] = useState("")
  const [emailError, setEmailError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const [code, setCode] = useState<string[]>(["", "", "", "", "", ""])
  const [codeError, setCodeError] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [resent, setResent] = useState(false)
  const otpRefs = useRef<(HTMLInputElement | null)[]>([])

  const focusOtp = (i: number) => {
    const el = otpRefs.current[i]
    if (el) {
      el.focus()
      el.select()
    }
  }

  // ── Step 1: send the email code ──
  const sendCode = async () => {
    if (!isLoaded || sending) return
    if (!EMAIL_RE.test(email)) {
      setEmailError("Introduce un correo válido.")
      return
    }
    setSending(true)
    setEmailError(null)
    try {
      const si = await signIn.create({ identifier: email })
      const factor = si.supportedFirstFactors?.find((f) => f.strategy === "email_code")
      const emailAddressId = (factor as { emailAddressId?: string } | undefined)?.emailAddressId
      if (!emailAddressId) throw new Error("Este correo no admite código por email.")
      await signIn.prepareFirstFactor({ strategy: "email_code", emailAddressId })
      setStep("code")
      setCode(["", "", "", "", "", ""])
      setCodeError(null)
      setTimeout(() => focusOtp(0), 60)
    } catch (e) {
      setEmailError(clerkError(e, "No pudimos enviar el código. Inténtalo de nuevo."))
    } finally {
      setSending(false)
    }
  }

  // ── Google OAuth ──
  const googleLogin = async () => {
    if (!isLoaded) return
    try {
      await signIn.authenticateWithRedirect({
        strategy: "oauth_google",
        redirectUrl: "/sso-callback",
        redirectUrlComplete: "/",
      })
    } catch (e) {
      setEmailError(clerkError(e, "No pudimos iniciar con Google."))
    }
  }

  // ── Step 2: verify the code ──
  const verify = async () => {
    if (!isLoaded || verifying) return
    const joined = code.join("")
    if (joined.length < 6) {
      setCodeError("Introduce los 6 dígitos.")
      return
    }
    setVerifying(true)
    setCodeError(null)
    try {
      const res = await signIn.attemptFirstFactor({ strategy: "email_code", code: joined })
      if (res.status === "complete") {
        await setActive({ session: res.createdSessionId })
        setStep("success")
        setTimeout(() => router.push("/"), 1300)
      } else {
        setCodeError("Código incorrecto. Revisa los dígitos e inténtalo otra vez.")
      }
    } catch (e) {
      setCodeError(clerkError(e, "Código incorrecto. Revisa los dígitos e inténtalo otra vez."))
      setCode(["", "", "", "", "", ""])
      setTimeout(() => focusOtp(0), 60)
    } finally {
      setVerifying(false)
    }
  }

  const resend = async () => {
    if (!isLoaded) return
    try {
      const factor = signIn.supportedFirstFactors?.find((f) => f.strategy === "email_code")
      const emailAddressId = (factor as { emailAddressId?: string } | undefined)?.emailAddressId
      if (!emailAddressId) return
      await signIn.prepareFirstFactor({ strategy: "email_code", emailAddressId })
      setResent(true)
      setCode(["", "", "", "", "", ""])
      setCodeError(null)
      setTimeout(() => focusOtp(0), 40)
      setTimeout(() => setResent(false), 2600)
    } catch (e) {
      setCodeError(clerkError(e, "No pudimos reenviar el código."))
    }
  }

  // ── OTP input handlers ──
  const onOtpInput = (i: number, value: string) => {
    const ch = value.replace(/\D/g, "").slice(-1)
    const next = code.slice()
    next[i] = ch
    setCode(next)
    setCodeError(null)
    if (ch && i < 5) setTimeout(() => focusOtp(i + 1), 0)
  }

  const onOtpKey = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      const next = code.slice()
      if (next[i]) {
        next[i] = ""
        setCode(next)
      } else if (i > 0) {
        next[i - 1] = ""
        setCode(next)
        setTimeout(() => focusOtp(i - 1), 0)
      }
    } else if (e.key === "ArrowLeft" && i > 0) {
      focusOtp(i - 1)
    } else if (e.key === "ArrowRight" && i < 5) {
      focusOtp(i + 1)
    } else if (e.key === "Enter") {
      verify()
    }
  }

  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const txt = (e.clipboardData.getData("text") || "").replace(/\D/g, "").slice(0, 6)
    if (!txt) return
    e.preventDefault()
    const next = ["", "", "", "", "", ""]
    for (let j = 0; j < txt.length; j++) next[j] = txt[j]
    setCode(next)
    setCodeError(null)
    setTimeout(() => focusOtp(Math.min(txt.length, 5)), 0)
  }

  const otpBox =
    "h-[62px] w-full rounded-[14px] border bg-white/[0.03] text-center font-mono text-[25px] font-semibold text-[#F2F6F4] outline-none transition-[border-color,box-shadow,background] focus:border-accent/70 focus:bg-accent/5 focus:shadow-[0_0_0_4px_rgba(63,191,132,0.12)]"
  const primaryBtn =
    "flex h-[52px] w-full items-center justify-center gap-2.5 rounded-[14px] bg-[linear-gradient(180deg,#5BE39A,#3FBF84)] text-[15px] font-bold tracking-tight text-[#08110B] shadow-[0_8px_24px_rgba(63,191,132,0.22)] transition-all hover:-translate-y-px hover:shadow-[0_10px_30px_rgba(63,191,132,0.28)] disabled:opacity-70"

  // ============ STEP: SUCCESS ============
  if (step === "success") {
    const full = nameFromEmail(email)
    const first = full.split(" ")[0]
    const initials =
      full
        .split(" ")
        .slice(0, 2)
        .map((w) => w.charAt(0).toUpperCase())
        .join("") || "NV"
    return (
      <div className="text-center">
        <div className="mx-auto flex h-[84px] w-[84px] items-center justify-center rounded-full border border-accent/35 bg-[linear-gradient(150deg,rgba(63,191,132,0.2),rgba(63,191,132,0.05))] shadow-[0_0_40px_rgba(63,191,132,0.25)]">
          <Check className="h-[42px] w-[42px] text-accent" strokeWidth={2.4} />
        </div>
        <h2 className="mt-[26px] text-[28px] font-extrabold tracking-tight text-[#F4F8F6]">
          ¡Hola de nuevo, {first}!
        </h2>
        <p className="mt-[11px] text-[15px] leading-relaxed text-[#8A938E]">
          Has iniciado sesión correctamente.
          <br />
          Te llevamos a tu panel de estudio…
        </p>
        <div className="mt-[26px] flex items-center gap-2.5 rounded-[14px] border border-white/[0.07] bg-white/[0.025] p-3.5">
          <div className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[10px] bg-[linear-gradient(140deg,#2c8d5f,#1b5a3c)] text-[13px] font-bold text-[#E8F7EE]">
            {initials}
          </div>
          <div className="min-w-0 text-left leading-tight">
            <div className="truncate text-[13.5px] font-semibold text-[#D6DEDA]">{full}</div>
            <div className="truncate text-[11.5px] text-[#7C8983]">{email}</div>
          </div>
          <Loader2 className="ml-auto h-[18px] w-[18px] animate-spin text-accent" />
        </div>
      </div>
    )
  }

  // ============ STEP: CODE ============
  if (step === "code") {
    return (
      <div>
        <button
          type="button"
          onClick={() => {
            setStep("email")
            setCode(["", "", "", "", "", ""])
            setCodeError(null)
          }}
          className="mb-[22px] inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#8A938E] transition-colors hover:text-[#C9D2CD]"
        >
          <ArrowLeft className="h-[15px] w-[15px]" strokeWidth={2.2} />
          Cambiar correo
        </button>

        <div className="mb-5 flex h-[54px] w-[54px] items-center justify-center rounded-[16px] border border-accent/[0.28] bg-[linear-gradient(150deg,rgba(63,191,132,0.16),rgba(63,191,132,0.04))] text-accent shadow-[0_0_26px_rgba(63,191,132,0.12)]">
          <Mail className="h-[25px] w-[25px]" strokeWidth={1.8} />
        </div>

        <h2 className="text-[26px] font-extrabold tracking-tight text-[#F4F8F6]">
          Revisa tu correo
        </h2>
        <p className="mt-2.5 text-[14.5px] leading-relaxed text-[#8A938E]">
          Enviamos un código de 6 dígitos a
          <br />
          <span className="font-semibold text-[#D6DEDA]">{email}</span>
        </p>

        <div className="mt-[26px] grid grid-cols-6 gap-2.5">
          {code.map((c, i) => (
            <input
              key={i}
              ref={(el) => {
                otpRefs.current[i] = el
              }}
              inputMode="numeric"
              maxLength={1}
              value={c}
              onChange={(e) => onOtpInput(i, e.target.value)}
              onKeyDown={(e) => onOtpKey(i, e)}
              onPaste={onPaste}
              autoFocus={i === 0}
              className={`${otpBox} ${codeError ? "border-[rgba(255,90,75,0.55)]" : "border-white/10"}`}
            />
          ))}
        </div>

        {codeError && (
          <div className="mt-4 flex items-center gap-2 rounded-[12px] border border-[rgba(255,90,75,0.22)] bg-[rgba(255,90,75,0.08)] px-3.5 py-2.5 text-[13px] font-medium text-[#FF8B7E]">
            <AlertCircle className="h-4 w-4 flex-none" strokeWidth={2} />
            {codeError}
          </div>
        )}

        <button
          type="button"
          onClick={verify}
          disabled={verifying}
          className={`mt-6 ${primaryBtn}`}
        >
          {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verificar y entrar"}
        </button>

        <div className="mt-[22px] text-center text-[13px] text-[#7C8983]">
          ¿No te llegó?{" "}
          <button
            type="button"
            onClick={resend}
            className="font-semibold text-accent hover:underline"
          >
            {resent ? "Código reenviado ✓" : "Reenviar código"}
          </button>
        </div>
      </div>
    )
  }

  // ============ STEP: EMAIL ============
  return (
    <div>
      <h2 className="text-[27px] font-extrabold tracking-tight text-[#F4F8F6]">
        Bienvenido de nuevo
      </h2>
      <p className="mt-2 text-[14.5px] leading-relaxed text-[#8A938E]">
        Inicia sesión para continuar en Navigator.
      </p>

      <button
        type="button"
        onClick={googleLogin}
        className="mt-[30px] flex h-[52px] w-full items-center justify-center gap-2.5 rounded-[14px] bg-white text-[14.5px] font-semibold text-[#1a1a1a] transition-all hover:-translate-y-px hover:shadow-[0_8px_24px_rgba(0,0,0,0.35)]"
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
        Continuar con Google
      </button>

      <div className="my-[22px] flex items-center gap-3.5">
        <div className="h-px flex-1 bg-white/10" />
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#4F5954]">
          o con tu correo
        </span>
        <div className="h-px flex-1 bg-white/10" />
      </div>

      <label className="mb-2 block text-[12.5px] font-semibold text-[#A9B2AD]">
        Correo electrónico
      </label>
      <div className="relative">
        <Mail
          className="pointer-events-none absolute left-[15px] top-1/2 -translate-y-1/2 text-[#5C6661]"
          width={17}
          height={17}
          strokeWidth={1.9}
        />
        <input
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            setEmailError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") sendCode()
          }}
          placeholder="tu@correo.com"
          autoFocus
          className={`h-[52px] w-full rounded-[14px] border bg-white/[0.03] pl-[42px] pr-4 text-base text-[#F2F6F4] outline-none transition-[border-color,box-shadow] focus:border-accent/60 focus:shadow-[0_0_0_4px_rgba(63,191,132,0.10)] sm:text-[14.5px] ${
            emailError ? "border-[rgba(255,90,75,0.55)]" : "border-white/10"
          }`}
        />
      </div>
      {emailError && (
        <div className="mt-2.5 flex items-center gap-1.5 text-[12.5px] text-[#FF8B7E]">
          <AlertCircle className="h-3.5 w-3.5 flex-none" strokeWidth={2} />
          {emailError}
        </div>
      )}

      <button
        type="button"
        onClick={sendCode}
        disabled={sending || !isLoaded}
        className={`mt-[18px] ${primaryBtn}`}
      >
        {sending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <>
            Enviar código
            <ArrowRight className="h-[17px] w-[17px]" strokeWidth={2.2} />
          </>
        )}
      </button>

      {/* Clerk bot-protection mount point (no-op when disabled). */}
      <div id="clerk-captcha" />

      <p className="mt-[26px] text-center text-[13px] text-[#7C8983]">
        ¿No tienes cuenta?{" "}
        <Link href="/sign-up" className="font-semibold text-accent hover:underline">
          Crear una gratis
        </Link>
      </p>
    </div>
  )
}
