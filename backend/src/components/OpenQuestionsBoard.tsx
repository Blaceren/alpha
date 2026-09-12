"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AdminFilters,
  AdminPageHeader,
  AdminSection,
  AdminSelect,
  AdminShell,
  StatusBadge,
} from "@/components/admin-ui";
import {
  openQuestionStatuses,
  type OpenQuestion,
  type OpenQuestionStatus,
} from "@/data/mockOpenQuestions";
import { updateOpenQuestionStatus } from "@/lib/api";

type OpenQuestionsBoardProps = {
  questions: OpenQuestion[];
};

export function OpenQuestionsBoard({ questions }: OpenQuestionsBoardProps) {
  const [selectedStatus, setSelectedStatus] =
    useState<"all" | OpenQuestionStatus>("all");
  const [items, setItems] = useState(questions);

  useEffect(() => {
    setItems(questions);
  }, [questions]);

  const filteredQuestions = useMemo(() => {
    if (selectedStatus === "all") {
      return items;
    }

    return items.filter((question) => question.status === selectedStatus);
  }, [items, selectedStatus]);

  async function changeQuestionStatus(
    questionId: number,
    status: OpenQuestionStatus,
  ) {
    const result = await updateOpenQuestionStatus(questionId, status);

    if (result.data) {
      setItems((currentItems) =>
        currentItems.map((question) =>
          question.id === questionId ? result.data : question,
        ),
      );
      return;
    }

    setItems((currentItems) =>
      currentItems.map((question) =>
        question.id === questionId ? { ...question, status } : question,
      ),
    );
  }

  return (
    <AdminShell>
      <AdminPageHeader
        title="Open questions"
        description="Internal admin-only board for unresolved product, technical and operational questions."
        breadcrumbs={[{ href: "/admin", label: "Admin" }, { label: "Open questions" }]}
      />

      <AdminFilters>
        <label className="min-w-56 flex-1 text-sm font-semibold text-[var(--text-secondary)]">
          Status
          <AdminSelect
            value={selectedStatus}
            onChange={(event) =>
              setSelectedStatus(event.target.value as "all" | OpenQuestionStatus)
            }
          >
            <option value="all">All statuses</option>
            {openQuestionStatuses.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </AdminSelect>
        </label>
        <StatusBadge value={`${filteredQuestions.length} questions`} />
      </AdminFilters>

      <div className="space-y-3">
        {filteredQuestions.map((question) => (
          <AdminSection key={question.id}>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="text-xs font-bold uppercase text-[var(--text-muted)]">
                  Question #{question.id}
                </div>
                <h2 className="mt-1 text-xl font-black text-[var(--text-primary)]">
                  {question.title}
                </h2>
                <p className="mt-2 text-sm text-[var(--text-secondary)]">{question.description}</p>
                <div className="mt-4 grid gap-2 text-sm text-[var(--text-secondary)] sm:grid-cols-2">
                  <p><span className="font-bold text-[var(--text-primary)]">Status:</span> <StatusBadge value={question.status} /></p>
                  <p><span className="font-bold text-[var(--text-primary)]">Priority:</span> {question.priority}</p>
                  <p><span className="font-bold text-[var(--text-primary)]">Owner:</span> {question.owner}</p>
                  <p><span className="font-bold text-[var(--text-primary)]">Note:</span> {question.note}</p>
                </div>
              </div>

              <label className="flex min-w-52 flex-col gap-1 text-sm font-semibold text-[var(--text-secondary)]">
                Change status
                <AdminSelect
                  value={question.status}
                  onChange={(event) =>
                    changeQuestionStatus(
                      question.id,
                      event.target.value as OpenQuestionStatus,
                    )
                  }
                >
                  {openQuestionStatuses.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </AdminSelect>
              </label>
            </div>
          </AdminSection>
        ))}
      </div>
    </AdminShell>
  );
}
