import { ProtectedPage } from "@/components/ProtectedPage";
import { SupportDialogDetail } from "@/components/SupportDialogDetail";

export default function SupportDialogPage() {
  return (
    <ProtectedPage allowedRoles={["admin", "support", "mentor"]}>
      <SupportDialogDetail />
    </ProtectedPage>
  );
}
