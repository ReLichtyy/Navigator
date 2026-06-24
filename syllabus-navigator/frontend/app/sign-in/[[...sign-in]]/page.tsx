import { SignIn } from "@clerk/nextjs"

export default function SignInPage() {
  return (
    <div className="flex min-h-dvh w-full flex-col items-center justify-center gap-6 bg-background px-4 py-12">
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent/10">
          <span className="text-2xl font-bold tracking-tighter text-accent">N</span>
        </div>
        <h1 className="text-lg font-semibold text-foreground">Navigator</h1>
        <p className="text-sm text-muted-foreground">Inicia sesión con tu correo o Google</p>
      </div>
      <SignIn />
    </div>
  )
}
