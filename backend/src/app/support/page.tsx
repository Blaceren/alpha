import { ProtectedPage } from "@/components/ProtectedPage";
import { SupportPanel } from "@/components/SupportPanel";

export default function SupportPage() {
  return (
    <ProtectedPage allowedRoles={["admin", "support", "mentor"]}>
      <SupportPanel />
    </ProtectedPage>
  );
}
