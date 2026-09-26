import { AdminPromocodesPanel } from "@/components/AdminPromocodesPanel";
import { ProtectedPage } from "@/components/ProtectedPage";
export default function AdminPromocodesPage(){return <ProtectedPage allowedRoles={["admin"]}><AdminPromocodesPanel/></ProtectedPage>;}
