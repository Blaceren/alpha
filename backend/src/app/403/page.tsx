import Link from "next/link";

export default function ForbiddenPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold">Нет доступа</h1>
      <p className="mt-3 text-gray-700">
        У вашей роли нет прав для просмотра этой страницы.
      </p>
      <Link
        href="/dashboard"
        className="mt-6 inline-block rounded border border-gray-300 px-4 py-2"
      >
        Вернуться в кабинет
      </Link>
    </main>
  );
}
