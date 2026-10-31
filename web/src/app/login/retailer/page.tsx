import { LoginScreen } from "@/components/LoginScreen";

/** Retailers: onboarding form for portal access, and sign in once approved. */
export default function RetailerLoginPage() {
  return <LoginScreen portals={["retailer"]} />;
}
