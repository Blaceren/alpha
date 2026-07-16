import type { Metadata } from "next";
import { AppShell } from "@/components/shell/app-shell";
import { LessonsLibraryWorkspace } from "@/features/lessons-library/components/lessons-library-workspace";
import { MODULE_QUERY_PARAM } from "@/features/lessons-library/model/lessons-library-model";
import "@/features/lessons-library/lessons-library.css";

export const metadata: Metadata = {
  title: "Уроки — Alfa Trade Academy",
  description:
    "Библиотека уроков: обзор модулей и уровней, продолжение текущего урока и возврат к пройденному материалу.",
};

/**
 * Уроки (/lessons) — the lessons library (Phase D2C-B).
 *
 * Until D2C this route was a redirect to the current lesson: D2B built the
 * lesson EXPERIENCE, not the library, so /lessons resolved to its documented
 * default instead of the 404 the navigation used to hit. That default is not
 * lost — it is PROMOTED to the page's dominant action «Продолжить обучение»
 * (DD-258).
 *
 * Module selection is ordinary user state in the URL: `?module=module.NN`, using
 * the curriculum's own canonical module code (no second identifier). It is NOT a
 * development scenario: it carries no progression, an unknown value falls back to
 * the user's current module, and Back/Forward work natively (DD-263).
 *
 * The marker is the SHARED sequential progress the Home and Path read. Session
 * completions are layered on the client, because the server cannot read
 * sessionStorage and must render the safe, sequence-only default (DD-256).
 */
export default async function LessonsLibraryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = params[MODULE_QUERY_PARAM];
  // A repeated query key arrives as an array; take the first and let the model's
  // parser reject anything that is not a canonical module code.
  const moduleParam = Array.isArray(raw) ? raw[0] : raw;

  return (
    <AppShell userName="Артём" activeId="lessons">
      {/* The canonical marker key — the library never takes one from the URL. */}
      <LessonsLibraryWorkspace moduleParam={moduleParam} scenario="active" />
    </AppShell>
  );
}
