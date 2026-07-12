"use client";

import { useEffect, useState } from "react";
import { ApiLoadState } from "@/components/ApiLoadState";
import { OpenQuestionsBoard } from "@/components/OpenQuestionsBoard";
import { ProtectedPage } from "@/components/ProtectedPage";
import type { OpenQuestion } from "@/data/mockOpenQuestions";
import { getOpenQuestions } from "@/lib/api";

export default function OpenQuestionsPage() {
  const [questions, setQuestions] = useState<OpenQuestion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isFallback, setIsFallback] = useState(false);

  useEffect(() => {
    getOpenQuestions().then((result) => {
      setQuestions(result.data);
      setIsFallback(result.isFallback);
      setIsLoading(false);
    });
  }, []);

  return (
    <ProtectedPage allowedRoles={["admin"]}>
      <div className="space-y-4">
      <ApiLoadState isLoading={isLoading} isFallback={isFallback} />
      <OpenQuestionsBoard questions={questions} />
      </div>
    </ProtectedPage>
  );
}
