"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/states/empty-state";
import {
  createNewsItem,
  fetchNewsItem,
  fetchNewsList,
  setNewsItemStatus,
  updateNewsItem,
  type NewsForm,
  type NewsOutcome,
} from "@/application/api/news-client";
import type { NewsItem, NewsReference } from "@/data/contracts/api/news";
import { Field, Select, TextArea, TextInput } from "@/features/affiliates/affiliate-form-fields";
import { cn } from "@/lib/cn";
import {
  EDITOR_TIME_ZONES,
  NEWS_FORM_LIMITS,
  NEWS_PATH,
  NEWS_STATUS_LABEL,
  browserTimeZone,
  checkNewsForm,
  emptyNewsForm,
  fieldForRefusal,
  formFromItem,
  importanceDots,
  instantToZonedWallTime,
  isFormChanged,
  newsItemPath,
  zoneLabel,
  zonedWallTimeToInstant,
  type NewsField,
} from "./news-model";

/**
 * TOOLS-V2 NEWS — «Новая новость» and one item.
 *
 * A new item is saved as a draft. Publishing is a separate, deliberate step,
 * and only a saved form can be published, so what goes public is exactly what
 * the copywriter last saved. Every save names the version it was made from; a
 * stale form is refused by the backend and nothing is overwritten.
 */

type Loaded = { item: NewsItem | null; reference: NewsReference };

type ViewState =
  | { kind: "loading" }
  | { kind: "ready"; loaded: Loaded }
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string };

type Banner = { tone: "success" | "danger" | "warning"; text: string } | null;

function failureText(outcome: Exclude<NewsOutcome<unknown>, { status: "success" }>): string {
  switch (outcome.status) {
    case "unauthenticated":
      return "Сессия закончилась. Войдите снова — несохранённый текст лучше скопировать.";
    case "forbidden":
      return outcome.reason === "csrf"
        ? "Не удалось подтвердить запрос. Обновите страницу и повторите."
        : "У вашей роли нет права менять новости.";
    case "rate_limited":
      return "Слишком много сохранений подряд. Подождите минуту.";
    case "stale":
      return "Эту новость уже изменили — в другой вкладке или другой сотрудник. Обновите страницу, чтобы увидеть последнюю версию; ваши правки не сохранены.";
    case "not_found":
      return "Новость не найдена.";
    case "upstream_unavailable":
      return "Нет связи с сервером. Попробуйте ещё раз.";
    default:
      return "Не получилось. Попробуйте ещё раз.";
  }
}

function todayIn(zone: string): string {
  return instantToZonedWallTime(Date.now(), zone).date;
}

export function NewsEditorWorkspace({ newsId }: { newsId?: string }) {
  const [state, setState] = React.useState<ViewState>({ kind: "loading" });
  const [reloadToken, setReloadToken] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    // A new item still reads the list once: it brings the reference lists and
    // tells a role without `news_publish` so before it types anything.
    const load: Promise<NewsOutcome<Loaded>> = newsId
      ? fetchNewsItem(newsId).then((outcome) =>
          outcome.status === "success" ? { status: "success", data: outcome.data } : outcome,
        )
      : fetchNewsList({ status: "draft", page: 1 }).then((outcome) =>
          outcome.status === "success"
            ? { status: "success", data: { item: null, reference: outcome.data.reference } }
            : outcome,
        );
    void load.then((outcome) => {
      if (cancelled) return;
      if (outcome.status === "success") setState({ kind: "ready", loaded: outcome.data });
      else if (outcome.status === "not_found") setState({ kind: "not_found" });
      else if (outcome.status === "forbidden") setState({ kind: "forbidden" });
      else setState({ kind: "error", message: failureText(outcome) });
    });
    return () => {
      cancelled = true;
    };
  }, [newsId, reloadToken]);

  const back = (
    <Link
      href={NEWS_PATH}
      className="inline-flex items-center gap-1 rounded text-sm text-text-secondary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ArrowLeft aria-hidden className="h-4 w-4" />
      Все новости
    </Link>
  );

  if (state.kind === "loading") {
    return (
      <div className="space-y-4">
        {back}
        <div role="status" aria-live="polite" className="space-y-2">
          <span className="sr-only">Загрузка новости</span>
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    );
  }
  if (state.kind === "not_found") {
    return (
      <div className="space-y-4">
        {back}
        <EmptyState titleAs="h1" title="Новость не найдена" description="Возможно, ссылка устарела. Вернитесь к списку." />
      </div>
    );
  }
  if (state.kind === "forbidden") {
    return (
      <div className="space-y-4">
        {back}
        <EmptyState titleAs="h1" title="Нет доступа" description="Раздел «Новости» доступен копирайтерам и администраторам CRM." />
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div className="space-y-4">
        {back}
        <div role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-3 text-sm text-text-primary">
          <p>{state.message}</p>
          <Button type="button" size="sm" variant="secondary" className="mt-2" onClick={() => setReloadToken((n) => n + 1)}>
            Повторить
          </Button>
        </div>
      </div>
    );
  }

  return (
    <NewsEditor
      key={state.loaded.item?.id ?? "new"}
      back={back}
      initial={state.loaded}
      onReload={() => setReloadToken((n) => n + 1)}
    />
  );
}

function NewsEditor({ back, initial, onReload }: { back: React.ReactNode; initial: Loaded; onReload: () => void }) {
  const router = useRouter();
  const [item, setItem] = React.useState<NewsItem | null>(initial.item);
  const [form, setForm] = React.useState<NewsForm>(() => {
    const zone = browserTimeZone();
    return initial.item ? formFromItem(initial.item, zone) : emptyNewsForm(zone, todayIn(zone));
  });
  const [errors, setErrors] = React.useState<Partial<Record<NewsField, string>>>({});
  const [banner, setBanner] = React.useState<Banner>(null);
  const [busy, setBusy] = React.useState<"save" | "status" | null>(null);
  const [confirmUnpublish, setConfirmUnpublish] = React.useState(false);
  const formRef = React.useRef<HTMLFormElement>(null);
  const { reference } = initial;

  const changed = item ? isFormChanged(form, item) : true;
  const releaseInstant = zonedWallTimeToInstant(form.releaseDate, form.releaseTime, form.timeZone);
  const zones = React.useMemo(() => {
    const own = browserTimeZone();
    return EDITOR_TIME_ZONES.some((entry) => entry.zone === own)
      ? EDITOR_TIME_ZONES
      : [{ zone: own, city: own.split("/").pop()!.replace(/_/g, " ") }, ...EDITOR_TIME_ZONES];
  }, []);

  function set<K extends keyof NewsForm>(key: K, value: NewsForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setBanner(null);
  }

  function focusField(field: NewsField) {
    const id = field === "release" ? "news-release-date" : `news-${field}`;
    formRef.current?.querySelector<HTMLElement>(`#${id}`)?.focus();
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const local = checkNewsForm(form);
    setErrors(local);
    const first = (Object.keys(local) as NewsField[])[0];
    if (first) {
      setBanner({ tone: "danger", text: "Проверьте отмеченные поля." });
      focusField(first);
      return;
    }
    setBusy("save");
    const outcome = item ? await updateNewsItem(item.id, form, item.updatedAt) : await createNewsItem(form);
    setBusy(null);
    if (outcome.status === "success") {
      if (!item) {
        router.replace(newsItemPath(outcome.data.id));
        return;
      }
      setItem(outcome.data);
      setForm(formFromItem(outcome.data, form.timeZone));
      setBanner({ tone: "success", text: outcome.data.status === "published" ? "Сохранено. Страница и календарь уже показывают новую версию." : "Черновик сохранён." });
      return;
    }
    if (outcome.status === "invalid_input") {
      const refusal = fieldForRefusal(outcome.detail);
      if (refusal.field) {
        setErrors({ [refusal.field]: refusal.message });
        focusField(refusal.field);
      }
      setBanner({ tone: "danger", text: refusal.message });
      return;
    }
    setBanner({ tone: outcome.status === "stale" ? "warning" : "danger", text: failureText(outcome) });
  }

  async function changeStatus(next: "published" | "draft") {
    if (!item) return;
    setBusy("status");
    const outcome = await setNewsItemStatus(item.id, next, item.updatedAt);
    setBusy(null);
    setConfirmUnpublish(false);
    if (outcome.status === "success") {
      setItem(outcome.data);
      setBanner({
        tone: "success",
        text: next === "published" ? "Опубликовано: страница открыта, новость в календаре учеников." : "Снято с публикации: страница закрыта, в календаре новости нет.",
      });
      return;
    }
    setBanner({ tone: outcome.status === "stale" ? "warning" : "danger", text: failureText(outcome) });
  }

  const title = item ? item.title : "Новая новость";

  return (
    <div className="space-y-4">
      {back}
      <PageHeader
        title={title}
        description={item ? `${item.countryLabel} · ${item.currency}` : "Сохраняется черновиком. Опубликовать можно после сохранения."}
        actions={
          item ? (
            <>
              <StatusBadge tone={item.status === "published" ? "success" : "neutral"} label={NEWS_STATUS_LABEL[item.status]} />
              {item.publicUrl ? (
                <Button asChild size="sm" variant="secondary">
                  <a href={item.publicUrl} target="_blank" rel="noopener noreferrer">
                    Открыть страницу
                    <ExternalLink aria-hidden className="h-3.5 w-3.5" />
                  </a>
                </Button>
              ) : null}
            </>
          ) : null
        }
      />

      {banner ? (
        <p
          role={banner.tone === "success" ? "status" : "alert"}
          className={cn(
            "rounded-sm border px-2 py-1.5 text-xs text-text-primary",
            banner.tone === "success" && "border-success/40 bg-success/10",
            banner.tone === "danger" && "border-danger/40 bg-danger/10",
            banner.tone === "warning" && "border-warning/40 bg-warning/10",
          )}
        >
          {banner.text}
          {banner.tone === "warning" ? (
            <Button type="button" size="sm" variant="secondary" className="ml-2" onClick={onReload}>
              Обновить
            </Button>
          ) : null}
        </p>
      ) : null}

      <form ref={formRef} noValidate onSubmit={save} className="space-y-5">
        <fieldset className="space-y-3 rounded-lg border border-border bg-surface p-3 sm:p-4">
          <legend className="px-1 text-sm font-semibold text-text-primary">Событие</legend>
          <div className="grid gap-3 md:grid-cols-2">
            <Field id="news-country" label="Страна" required error={errors.country}>
              {(aria) => (
                <Select {...aria} value={form.country} onChange={(event) => set("country", event.target.value)}>
                  {reference.countries.map((entry) => (
                    <option key={entry.code} value={entry.code}>
                      {entry.label} · {entry.currency}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <fieldset aria-describedby={errors.importance ? "news-importance-error" : undefined}>
              <legend className="text-xs font-medium text-text-primary">
                Важность<span className="ml-0.5 text-danger" aria-hidden>*</span>
              </legend>
              <div className="mt-1 flex flex-wrap gap-2" role="radiogroup" aria-label="Важность">
                {reference.importance.map((level) => (
                  <label
                    key={level.value}
                    className={cn(
                      "inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-sm border px-2.5 text-sm",
                      form.importance === level.value
                        ? "border-accent bg-accent/10 text-text-primary"
                        : "border-border text-text-secondary hover:bg-row-hover",
                    )}
                  >
                    <input
                      id={level.value === form.importance ? "news-importance" : undefined}
                      type="radio"
                      name="news-importance"
                      value={level.value}
                      checked={form.importance === level.value}
                      onChange={() => set("importance", level.value)}
                      className="accent-accent"
                    />
                    <span aria-hidden className="tracking-widest">
                      {importanceDots(level.value)}
                    </span>
                    {level.label}
                  </label>
                ))}
              </div>
              {errors.importance ? (
                <p id="news-importance-error" className="mt-1 text-2xs text-danger">
                  {errors.importance}
                </p>
              ) : null}
            </fieldset>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field id="news-release-date" label="Дата выхода" required error={errors.release}>
              {(aria) => (
                <TextInput {...aria} type="date" value={form.releaseDate} onChange={(event) => set("releaseDate", event.target.value)} />
              )}
            </Field>
            <Field id="news-releaseTime" label="Время выхода" required>
              {(aria) => (
                <TextInput
                  {...aria}
                  type="time"
                  step={60}
                  value={form.releaseTime}
                  aria-invalid={errors.release ? true : undefined}
                  onChange={(event) => set("releaseTime", event.target.value)}
                />
              )}
            </Field>
            <Field
              id="news-timeZone"
              label="Часовой пояс времени выхода"
              error={errors.timeZone}
              hint={
                releaseInstant !== null
                  ? `Сохранится как ${instantToZonedWallTime(releaseInstant, "UTC").time} UTC, ${instantToZonedWallTime(releaseInstant, "UTC").date}`
                  : undefined
              }
            >
              {(aria) => (
                <Select {...aria} value={form.timeZone} onChange={(event) => set("timeZone", event.target.value)}>
                  {zones.map((entry) => (
                    <option key={entry.zone} value={entry.zone}>
                      {zoneLabel(entry.zone, releaseInstant ?? Date.now())}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        </fieldset>

        <fieldset className="space-y-3 rounded-lg border border-border bg-surface p-3 sm:p-4">
          <legend className="px-1 text-sm font-semibold text-text-primary">Значения</legend>
          <p className="text-2xs text-text-secondary">
            Как в экономическом календаре: «0.3%», «215K». Факт вносится после выхода — страница и календарь покажут его сразу после сохранения.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            {(
              [
                ["forecast", "Прогноз"],
                ["previous", "Предыдущее"],
                ["actual", "Факт"],
              ] as const
            ).map(([key, label]) => (
              <Field key={key} id={`news-${key}`} label={label} error={errors[key]}>
                {(aria) => (
                  <TextInput
                    {...aria}
                    value={form[key]}
                    maxLength={NEWS_FORM_LIMITS.value}
                    placeholder="—"
                    onChange={(event) => set(key, event.target.value)}
                  />
                )}
              </Field>
            ))}
          </div>
        </fieldset>

        <fieldset className="space-y-3 rounded-lg border border-border bg-surface p-3 sm:p-4">
          <legend className="px-1 text-sm font-semibold text-text-primary">Страница новости</legend>
          <Field id="news-title" label="Название события" required error={errors.title} hint="Как в календаре: «Базовый индекс потребительских цен, м/м».">
            {(aria) => (
              <TextInput {...aria} value={form.title} maxLength={NEWS_FORM_LIMITS.title.max} onChange={(event) => set("title", event.target.value)} />
            )}
          </Field>
          <Field
            id="news-summary"
            label="Лид"
            required
            error={errors.summary}
            hint={`Первые строки страницы и её описание в поиске. ${form.summary.trim().length} из ${NEWS_FORM_LIMITS.summary.max}.`}
          >
            {(aria) => (
              <TextArea {...aria} rows={3} value={form.summary} maxLength={NEWS_FORM_LIMITS.summary.max} onChange={(event) => set("summary", event.target.value)} />
            )}
          </Field>
          <Field id="news-body" label="Текст" error={errors.body} hint="Абзацы разделяйте пустой строкой. Разметка и ссылки в тексте не нужны.">
            {(aria) => (
              <TextArea {...aria} rows={12} value={form.body} maxLength={NEWS_FORM_LIMITS.body} onChange={(event) => set("body", event.target.value)} />
            )}
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="news-sourceName" label="Источник" error={errors.sourceName} hint="Например: U.S. Bureau of Labor Statistics">
              {(aria) => (
                <TextInput {...aria} value={form.sourceName} maxLength={NEWS_FORM_LIMITS.sourceName} onChange={(event) => set("sourceName", event.target.value)} />
              )}
            </Field>
            <Field id="news-sourceUrl" label="Адрес источника" error={errors.sourceUrl} hint="https://…">
              {(aria) => (
                <TextInput
                  {...aria}
                  type="url"
                  inputMode="url"
                  value={form.sourceUrl}
                  maxLength={NEWS_FORM_LIMITS.sourceUrl}
                  onChange={(event) => set("sourceUrl", event.target.value)}
                />
              )}
            </Field>
          </div>
        </fieldset>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={busy !== null || (item !== null && !changed)}>
            {busy === "save" ? "Сохраняю…" : item ? "Сохранить изменения" : "Сохранить черновик"}
          </Button>
          {item && !changed ? <span className="text-xs text-text-secondary">Изменений нет.</span> : null}
          {item && changed ? <span className="text-xs text-text-secondary">Есть несохранённые правки.</span> : null}
        </div>
      </form>

      {item ? (
        <section aria-labelledby="news-publication" className="space-y-3 rounded-lg border border-border bg-surface p-3 sm:p-4">
          <h2 id="news-publication" className="text-sm font-semibold text-text-primary">
            Публикация
          </h2>
          <p className="text-xs text-text-secondary">
            Адрес страницы: <code className="font-mono text-text-primary">/news/{item.slug}</code>
            {item.slugLocked
              ? " — закреплён после первой публикации и больше не меняется."
              : " — до первой публикации следует за названием, страной и датой."}
          </p>
          {item.status === "draft" ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" disabled={busy !== null || changed} onClick={() => void changeStatus("published")}>
                {busy === "status" ? "Публикую…" : "Опубликовать"}
              </Button>
              <span className="text-xs text-text-secondary">
                {changed
                  ? "Сначала сохраните правки — публикуется сохранённая версия."
                  : "Страница откроется для всех, новость появится в News Calendar учеников."}
              </span>
            </div>
          ) : confirmUnpublish ? (
            <div role="alertdialog" aria-labelledby="news-unpublish-question" className="space-y-2">
              <p id="news-unpublish-question" className="text-sm text-text-primary">
                Страница перестанет открываться, новость уйдёт из календаря учеников. Адрес сохранится. Снять с публикации?
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="danger" size="sm" disabled={busy !== null} onClick={() => void changeStatus("draft")}>
                  {busy === "status" ? "Снимаю…" : "Снять с публикации"}
                </Button>
                <Button type="button" variant="secondary" size="sm" onClick={() => setConfirmUnpublish(false)}>
                  Отмена
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="secondary" disabled={busy !== null} onClick={() => setConfirmUnpublish(true)}>
                Снять с публикации
              </Button>
              <span className="text-xs text-text-secondary">
                Опубликована{item.publishedAt ? ` ${new Date(item.publishedAt).toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" })}` : ""}.
              </span>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
