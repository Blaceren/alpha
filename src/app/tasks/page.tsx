"use client";

import { useEffect, useState } from "react";
import { ApiLoadState } from "@/components/ApiLoadState";
import { ProtectedPage } from "@/components/ProtectedPage";
import { TaskChain } from "@/components/TaskChain";
import { PageHeader } from "@/components/ui";
import type { MockTask } from "@/types/tasks";
import { getTasks } from "@/lib/api";

export default function TasksPage() {
  const [tasks, setTasks] = useState<MockTask[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isFallback, setIsFallback] = useState(false);

  useEffect(() => {
    getTasks().then((result) => {
      setTasks(result.data);
      setIsFallback(result.isFallback);
      setIsLoading(false);
    });
  }, []);

  return (
    <ProtectedPage allowedRoles={["user", "admin", "support", "mentor"]}>
      <div className="space-y-6">
        <PageHeader
          kicker="Цепочка заданий"
          title="Задания и награды"
          description="16 уровней обучения: уроки, отчёты, Pocket postbacks и проверки баланса."
        />
        <ApiLoadState isLoading={isLoading} isFallback={isFallback} />
        <TaskChain initialTasks={tasks} />
      </div>
    </ProtectedPage>
  );
}
