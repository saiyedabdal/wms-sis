import { LoginScreen } from "@/components/LoginScreen";

/** Super stockists: onboarding form for portal access, and sign in once approved. */
export default function SuperStockistLoginPage() {
  return <LoginScreen portals={["super_stockist"]} />;
}
