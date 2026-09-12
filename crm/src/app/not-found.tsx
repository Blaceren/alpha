import Link from "next/link";
import { Button } from "@/components/ui/button";

/** Global 404 for unknown routes. */
export default function NotFound() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-lg border border-border bg-surface p-6 text-center">
        <p className="text-2xs font-semibold uppercase tracking-wide text-text-muted">
          Ошибка 404
        </p>
        <h1 className="mt-1 text-base font-semibold text-text-primary">Страница не найдена</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Такого раздела нет. Проверьте адрес или вернитесь на главный экран.
        </p>
        <Button asChild className="mt-4">
          <Link href="/today">На «Сегодня»</Link>
        </Button>
      </div>
    </div>
  );
}
