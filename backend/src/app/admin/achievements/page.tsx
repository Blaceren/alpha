import { AdminAchievementsPanel } from "@/components/AdminAchievementsPanel";
import { ProtectedPage } from "@/components/ProtectedPage";
export default function AdminAchievementsPage(){return <ProtectedPage allowedRoles={["admin"]}><AdminAchievementsPanel/></ProtectedPage>;}
