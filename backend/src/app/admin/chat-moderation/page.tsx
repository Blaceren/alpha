import { ChatModerationPanel } from "@/components/ChatModerationPanel";
import { ProtectedPage } from "@/components/ProtectedPage";

export default function ChatModerationPage() {
  return <ProtectedPage allowedRoles={["admin", "moderator"]}><ChatModerationPanel /></ProtectedPage>;
}
