/**
 * Auth layout — minimal wrapper for login/signup pages.
 * Centers the form vertically and horizontally.
 */

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  )
}
