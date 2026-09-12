"use client";

import { useEffect, useState } from "react";
import { ApiLoadState } from "@/components/ApiLoadState";
import { ChatRoom } from "@/components/ChatRoom";
import { ProtectedPage } from "@/components/ProtectedPage";
import { PageHeader } from "@/components/ui";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import type { MockChatMessage } from "@/data/mockChat";
import { getChatMessages } from "@/lib/api";

export default function ChatPage() {
  const [messages, setMessages] = useState<MockChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isFallback, setIsFallback] = useState(false);

  useEffect(() => {
    getChatMessages().then((result) => {
      setMessages(result.data);
      setIsFallback(result.isFallback);
      setIsLoading(false);
    });
  }, []);

  return (
    <ProtectedPage allowedRoles={["user", "admin", "support", "mentor", "moderator"]}>
      <div className="space-y-6">
        <Breadcrumbs items={[{ href: "/dashboard", label: "Главная" }, { label: "Сообщество" }]} />
        <PageHeader
          kicker="Комьюнити"
          title="Сообщество"
          description="Общие, учебные и закрытые каналы. Доступ зависит от уровня, checkpoint или достижения."
        />
        <ApiLoadState isLoading={isLoading} isFallback={isFallback} />
        <ChatRoom initialMessages={messages} />
      </div>
    </ProtectedPage>
  );
}
