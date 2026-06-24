import { redirect } from "next/navigation"

// Legacy route — auth is handled by Clerk at /sign-up now.
export default function SignupRedirect() {
  redirect("/sign-up")
}
