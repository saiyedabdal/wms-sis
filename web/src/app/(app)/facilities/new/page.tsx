import { PageHeader } from "@/components/ui";
import { FacilityForm } from "../FacilityForm";

export default function NewFacilityPage() {
  return (
    <>
      <PageHeader title="New facility" back={{ href: "/facilities", label: "Facilities" }} />
      <FacilityForm />
    </>
  );
}
