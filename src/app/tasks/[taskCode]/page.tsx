"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ProtectedPage } from "@/components/ProtectedPage";
import { Alert, Card, PageHeader } from "@/components/ui";
import { completeTask, getTasks } from "@/lib/api";
import { lessons } from "@/lib/lessonContent";
import type { MockTask } from "@/types/tasks";

export default function LessonPage() {
  return <ProtectedPage allowedRoles={["user"]}><LessonContent /></ProtectedPage>;
}

function LessonContent() {
  const params = useParams<{ taskCode: string }>();
  const router = useRouter();
  const lesson = lessons[params.taskCode];
  const [task, setTask] = useState<MockTask | null>(null);
  const [answer, setAnswer] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void getTasks().then((result) => setTask(result.data.find((item) => item.code === params.taskCode) ?? null));
  }, [params.taskCode]);

  if (!lesson) return <Alert>Урок не найден.</Alert>;

  async function completeLesson() {
    if (!task || answer !== lesson.correctAnswer) {
      setMessage("Выберите правильный ответ, чтобы завершить урок.");
      return;
    }
    setSaving(true);
    const result = await completeTask(task.id);
    setSaving(false);
    if (result.isFallback || !result.data.length) {
      setMessage(result.error ?? "Не удалось завершить урок");
      return;
    }
    setMessage("Урок завершён. XP начислен один раз, следующий шаг активирован.");
    router.refresh();
  }

  return (
    <section className="space-y-6">
      <Breadcrumbs items={[{ href: "/dashboard", label: "Главная" }, { href: "/tasks", label: "Задания" }, { label: lesson.title }]} />
      <PageHeader kicker="Урок" title={lesson.title} description={lesson.summary} />
      {task?.status === "locked" || task?.status === "frozen" ? <Alert>Этот урок пока заблокирован текущей последовательностью курса.</Alert> : null}
      <div className="space-y-4">
        {lesson.sections.map((section) => <Card key={section.title}><h2 className="section-title">{section.title}</h2><p className="mt-3 leading-7 text-[var(--text-secondary)]">{section.body}</p></Card>)}
      </div>
      <Card>
        <h2 className="section-title">Контрольный вопрос</h2>
        <p className="mt-3 font-bold text-[var(--text-primary)]">{lesson.question}</p>
        <div className="mt-4 space-y-2">{lesson.answers.map((item, index) => <label key={item} className="flex cursor-pointer gap-3 rounded-xl border border-[var(--border)] p-3"><input type="radio" name="answer" checked={answer === index} onChange={() => setAnswer(index)} /><span>{item}</span></label>)}</div>
        {message ? <Alert className="mt-4">{message}</Alert> : null}
        <button type="button" className="btn btn-primary mt-4" disabled={saving || task?.status === "locked" || task?.status === "frozen" || task?.status === "completed"} onClick={completeLesson}>{task?.status === "completed" ? "Урок выполнен" : saving ? "Сохраняем..." : "Завершить урок"}</button>
      </Card>
    </section>
  );
}
