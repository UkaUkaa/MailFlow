import { RedirectIfAuthenticated, RegisterForm } from "@/modules/authentication";

export default function RegisterPage() {
  return (
    <RedirectIfAuthenticated>
      <RegisterForm />
    </RedirectIfAuthenticated>
  );
}
