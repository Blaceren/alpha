"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useTradingJournal } from "@/features/tools/hooks/use-trading-journal";
import type { JournalEntryInput } from "@/features/tools/model/journal-entry";
import { JournalEntryForm } from "@/features/tools/components/journal-entry-form";
import { JournalEntryNode } from "@/features/tools/components/journal-entry-node";

type Mode = { kind: "idle" } | { kind: "create" } | { kind: "edit"; id: string };

/**
 * Trading Journal workspace (Phase D4-B) — direction «Structured Operational
 * Spine», journal half built on Direction C «Structured Field Notebook»
 * (DD-308). A single numbered spine: the new-entry node at the head, then the
 * saved entries newest-first. Each entry expands in place into the triptych
 * ПЛАН → ИСПОЛНЕНИЕ → УРОК; the lesson is the point, the money result a quiet
 * margin note.
 *
 * Browser-local only (`useTradingJournal`): nothing is sent to a broker or a
 * server, and the surface says exactly that. Corrupt local data fails closed to
 * an empty workspace with a calm explanation, never a raw payload.
 */
export function TradingJournalWorkspace() {
  const { entries, corrupt, durable, saveState, create, update } = useTradingJournal();

  const [mode, setMode] = useState<Mode>({ kind: "idle" });
  const [expandedOverride, setExpandedOverride] = useState<Set<string> | null>(null);

  const newestId = entries[0]?.id ?? null;
  const isExpanded = useCallback(
    (id: string) => (expandedOverride ?? new Set(newestId ? [newestId] : [])).has(id),
    [expandedOverride, newestId],
  );

  const toggleExpanded = useCallback(
    (id: string) => {
      setExpandedOverride((prev) => {
        const base = new Set(prev ?? (newestId ? [newestId] : []));
        if (base.has(id)) base.delete(id);
        else base.add(id);
        return base;
      });
    },
    [newestId],
  );

  /* ---------------- focus management ---------------- */
  const nodeRefs = useRef(new Map<string, HTMLButtonElement>());
  const addBtnRef = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<null | { kind: "node"; id: string } | { kind: "add" }>(null);
  const [focusTick, setFocusTick] = useState(0);

  const registerNode = useCallback((id: string, el: HTMLButtonElement | null) => {
    if (el) nodeRefs.current.set(id, el);
    else nodeRefs.current.delete(id);
  }, []);

  useEffect(() => {
    if (focusTick === 0) return;
    const target = pendingFocus.current;
    pendingFocus.current = null;
    if (!target) return;
    if (target.kind === "add") {
      addBtnRef.current?.focus();
    } else {
      const el = nodeRefs.current.get(target.id);
      el?.focus();
    }
  }, [focusTick]);

  const requestFocus = useCallback((target: { kind: "node"; id: string } | { kind: "add" }) => {
    pendingFocus.current = target;
    setFocusTick((t) => t + 1);
  }, []);

  /* ---------------- mutations ---------------- */
  const onCreate = useCallback(
    (input: JournalEntryInput) => {
      const result = create(input);
      if (result.ok && result.entry) {
        setMode({ kind: "idle" });
        // Ensure the just-created entry is expanded and take focus to it.
        setExpandedOverride((prev) => {
          const base = new Set(prev ?? (newestId ? [newestId] : []));
          base.add(result.entry!.id);
          return base;
        });
        requestFocus({ kind: "node", id: result.entry.id });
      }
      return result;
    },
    [create, newestId, requestFocus],
  );

  const onEditSubmit = useCallback(
    (id: string, input: JournalEntryInput) => {
      const result = update(id, input);
      if (result.ok) {
        setMode({ kind: "idle" });
        requestFocus({ kind: "node", id });
      }
      return result;
    },
    [update, requestFocus],
  );

  const cancelForm = useCallback(() => {
    const current = mode;
    setMode({ kind: "idle" });
    if (current.kind === "edit") requestFocus({ kind: "node", id: current.id });
    else requestFocus({ kind: "add" });
  }, [mode, requestFocus]);

  const openCreate = useCallback(() => setMode({ kind: "create" }), []);
  const openEdit = useCallback((id: string) => setMode({ kind: "edit", id }), []);

  const editingId = mode.kind === "edit" ? mode.id : null;
  const pending = saveState === "pending";
  const storageError = saveState === "storage-error";

  const saveNote = useMemo(() => {
    if (!durable) return "Локальное сохранение недоступно — записи не сохранятся после закрытия вкладки.";
    if (storageError) return "Не удалось сохранить в этом браузере.";
    if (saveState === "saved") return "Сохранено в этом браузере.";
    return "Записи хранятся только в этом браузере.";
  }, [durable, storageError, saveState]);

  return (
    <div className="je-page">
      <header className="je-head">
        <Link className="je-back" href="/tools">
          <span aria-hidden="true">←</span> Инструменты
        </Link>
        <div className="je-id">
          <span className="je-num mono" aria-hidden="true">
            10
          </span>
          <h1 className="je-h1">Trading Journal</h1>
        </div>
        <p className="je-manual">
          <span className="je-manual-i" aria-hidden="true">
            (i)
          </span>{" "}
          Записи вводятся вручную и не синхронизируются с брокером.
        </p>
        <p className="je-save" role="status" aria-live="polite">
          <span className={`je-save-dot is-${storageError ? "error" : durable ? "ok" : "off"}`} aria-hidden="true" />
          {saveNote}
        </p>
      </header>

      {corrupt && (
        <div className="je-corrupt" role="status">
          <p className="je-corrupt-h">Локальные записи не удалось прочитать</p>
          <p className="je-corrupt-t">
            Сохранённые в этом браузере данные журнала повреждены и не были показаны. Новые записи
            можно добавлять — они перезапишут повреждённые. Ничего не отправлялось ни на сервер, ни
            брокеру.
          </p>
        </div>
      )}

      {/* The spine. Head node = new entry; then saved entries newest-first. */}
      <ol className="je-spine" aria-label="Записи журнала">
        <li className="je-node je-add">
          <span className="je-node-dot is-add" aria-hidden="true">
            <span className="je-node-num">+</span>
          </span>
          <div className="je-node-body">
            {mode.kind === "create" ? (
              <JournalEntryForm
                mode="create"
                onSubmit={onCreate}
                onCancel={cancelForm}
                pending={pending}
                storageError={storageError}
              />
            ) : (
              <button ref={addBtnRef} type="button" className="je-add-btn" onClick={openCreate}>
                <span className="je-add-plus" aria-hidden="true">
                  +
                </span>
                Новая запись
              </button>
            )}
          </div>
        </li>

        {entries.length === 0 && !corrupt && mode.kind !== "create" ? (
          <li className="je-node je-empty">
            <span className="je-node-dot is-empty" aria-hidden="true" />
            <div className="je-node-body">
              <p className="je-empty-h">Здесь появится ваша первая запись</p>
              <p className="je-empty-t">
                Запишите одну сделку или осознанное решение не входить: план, что вы сделали и — самое
                важное — какой вывод. Денежный результат можно указать, а можно оставить пустым.
              </p>
              <button type="button" className="je-empty-cta" onClick={openCreate}>
                Добавить первую запись
              </button>
            </div>
          </li>
        ) : (
          entries.map((entry) =>
            editingId === entry.id ? (
              <li key={entry.id} className="je-node is-editing">
                <span className="je-node-dot" aria-hidden="true">
                  <span className="je-node-num mono">
                    {String(Number(/journal-(\d+)/.exec(entry.id)?.[1] ?? 0)).padStart(2, "0")}
                  </span>
                </span>
                <div className="je-node-body">
                  <JournalEntryForm
                    mode="edit"
                    initial={entry}
                    onSubmit={(input) => onEditSubmit(entry.id, input)}
                    onCancel={cancelForm}
                    pending={pending}
                    storageError={storageError}
                  />
                </div>
              </li>
            ) : (
              <JournalEntryNode
                key={entry.id}
                ref={(el) => registerNode(entry.id, el)}
                entry={entry}
                expanded={isExpanded(entry.id)}
                onToggle={() => toggleExpanded(entry.id)}
                onEdit={() => openEdit(entry.id)}
              />
            ),
          )
        )}
      </ol>
    </div>
  );
}
