import { LoginScreen } from "@/components/LoginScreen";

/** Frido team: admins / managers / ops and the field sales team. Retailers and SS have their own pages. */
export default function LoginPage() {
  return <LoginScreen portals={["admin", "field_sales"]} />;
}
