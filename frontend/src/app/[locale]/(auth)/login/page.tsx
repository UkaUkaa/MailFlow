import { LoginForm, RedirectIfAuthenticated } from "@/modules/authentication";

export default function LoginPage() {
  return (
    <RedirectIfAuthenticated>
      <LoginForm />
    </RedirectIfAuthenticated>
  );
}
