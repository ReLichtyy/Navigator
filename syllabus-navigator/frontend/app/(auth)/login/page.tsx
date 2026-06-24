import { redirect } from "next/navigation"

// Legacy route — auth is handled by Clerk at /sign-in now.
export default function LoginRedirect() {
  redirect("/sign-in")
}
