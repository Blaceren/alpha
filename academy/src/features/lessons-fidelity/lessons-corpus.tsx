"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { countPhrase, foundPhrase } from "@/features/lessons-fidelity/ru-plural";

/**
 * THE REFERENCE CORPUS — one tonal territory, and the only interactive part of
 * the Lessons index.
 *
 * The head above it is server-rendered; this owns the register, because search
 * filters it and search is a client capability. Everything it renders comes from
 * the material list the server passed down — it fetches nothing and decides no
 * eligibility of its own.
 */
export type CorpusMaterial = {
  /** Canonical level code — the product's identity, not a positional index. */
  levelCode: string;
  order: number;
  title: string;
  href: string;
  moduleOrder: number;
  moduleTitle: string;
  /** Reached, but its content cannot be opened right now. */
  unavailable: boolean;
};

/**
 * SEARCH IS A CAPABILITY INPUT WITH A SAFE DEFAULT, AND THE DEFAULT IS HIDDEN.
 *
 * This is the frozen design's own instruction, not a shortcut. Its engineering
 * handoff lists the search rollout threshold as NEEDS PRODUCT, requires
 * "capability as VM input; safe default `hidden`; no encoded number", and its
 * acceptance tests include "search capability is a VM input; no numeric
 * threshold is encoded". A count chosen here would be exactly the magic number
 * the design refuses to invent — so the control is built, capability-conditional,
 * and stays hidden until somebody with the authority to set the rule sets it.
 */
export type SearchCapability = "hidden" | "available";

/** How long the settled announcement waits after the last keystroke. */
const ANNOUNCE_SETTLE_MS = 400;

export function LessonsCorpus({
  materials,
  capability,
}: {
  materials: CorpusMaterial[];
  capability: SearchCapability;
}) {
  const [query, setQuery] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Filtering is IMMEDIATE and atomic — headers and materials commit as one
     set. Only the ANNOUNCEMENT settles, so assistive technology hears the
     result state once instead of hearing every keystroke. */
  const trimmed = query.trim().toLowerCase();
  const hits = useMemo(() => {
    if (!trimmed) return materials;
    return materials.filter(
      (m) =>
        m.title.toLowerCase().includes(trimmed) ||
        m.moduleTitle.toLowerCase().includes(trimmed) ||
        String(m.order) === trimmed,
    );
  }, [materials, trimmed]);

  const mode = !trimmed ? "browse" : hits.length === 0 ? "zero" : "search";

  function onQuery(value: string) {
    setQuery(value);
    const next = value.trim().toLowerCase();
    const count = !next
      ? materials.length
      : materials.filter(
          (m) =>
            m.title.toLowerCase().includes(next) ||
            m.moduleTitle.toLowerCase().includes(next) ||
            String(m.order) === next,
        ).length;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setAnnouncement(
        !next ? "Показаны все материалы." : count === 0 ? "По запросу ничего не найдено." : foundPhrase(count),
      );
    }, ANNOUNCE_SETTLE_MS);
  }

  return (
    <section className="corpus" id="corpus" aria-label="Справочные материалы">
      {capability === "available" ? (
        <div className="corpus__search" id="search-slot">
          <label className="corpus__search-label" htmlFor="search-input">
            Поиск по материалам
          </label>
          {/* No autofocus, ever: arriving on the page is not a search. */}
          <input
            type="search"
            id="search-input"
            autoComplete="off"
            spellCheck={false}
            placeholder="Название материала или модуля"
            value={query}
            onChange={(event) => onQuery(event.target.value)}
          />
        </div>
      ) : null}

      {/* The ONE Lessons status region: settled search-result state only.
          Polite, debounced — never per keystroke. */}
      <p className="visually-hidden" role="status" id="search-status">
        {announcement}
      </p>

      <div id="corpus-body" data-mode={mode}>
        {mode === "zero" ? (
          <p className="corpus__search-empty">По вашему запросу ничего не найдено.</p>
        ) : materials.length === 0 ? (
          <CorpusZero />
        ) : (
          <Groups materials={hits} asHits={mode === "search"} />
        )}
      </div>
    </section>
  );
}

/**
 * The legitimately-early state: nothing is open yet. It is not an error and not
 * a search result, so it says what will fill the page rather than what is
 * missing from it.
 */
function CorpusZero() {
  return (
    <div className="corpus-zero">
      <p className="corpus-zero__title">Материалы пока не открыты</p>
      <p className="corpus-zero__line">
        Как только вы начнёте первый уровень, его материалы появятся здесь.
      </p>
      <p className="corpus-zero__line">
        Сюда будут собираться материалы пройденных уровней — чтобы к ним можно было вернуться в
        любой момент.
      </p>
    </div>
  );
}

function Groups({ materials, asHits }: { materials: CorpusMaterial[]; asHits: boolean }) {
  const moduleOrders = [...new Set(materials.map((m) => m.moduleOrder))];
  return (
    <>
      {moduleOrders.map((moduleOrder) => {
        const inModule = materials.filter((m) => m.moduleOrder === moduleOrder);
        const moduleTitle = inModule[0]?.moduleTitle ?? "";
        const headingId = `group-h-${moduleOrder}`;
        const kicker = `Модуль ${String(moduleOrder).padStart(2, "0")}`;
        return (
          <section className="group" aria-labelledby={headingId} key={moduleOrder}>
            <div className="group__context">
              {/* The heading names the group for assistive technology; the two
                  visible lines are the same information, split for the eye, and
                  are hidden from the accessibility tree so it is not read twice. */}
              <h2 id={headingId} className="visually-hidden">
                {kicker} · {moduleTitle}
              </h2>
              <p className="group__kicker" aria-hidden="true">
                {kicker}
              </p>
              <p className="group__name" aria-hidden="true">
                {moduleTitle}
              </p>
            </div>
            <ul className="group__list">
              {inModule.map((material) => (
                <Material key={material.levelCode} material={material} asHit={asHits} />
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}

/**
 * FULL-ROW LINK CONTRACT. The material has exactly one destination — the Reader
 * — so the whole logical row is ONE ordinary navigation link with no nested
 * controls. The accessible name is the title alone.
 *
 * A material that cannot be opened is not a link at all. Rendering it as one and
 * letting it fail would be asserting a destination that does not work.
 */
function Material({ material, asHit }: { material: CorpusMaterial; asHit: boolean }) {
  const className = [
    "material",
    material.unavailable ? "material--unavailable" : "",
    asHit && !material.unavailable ? "material--hit" : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (material.unavailable) {
    return (
      <li className={className} data-level={material.levelCode}>
        <span className="material__still">
          <span className="material__title">{material.title}</span>
          <span className="material__meta">Материал сейчас недоступен.</span>
        </span>
      </li>
    );
  }

  const titleId = `m-title-${material.order}`;
  return (
    <li className={className} data-level={material.levelCode}>
      <Link className="material__open" href={material.href} aria-labelledby={titleId}>
        <span className="material__title" id={titleId}>
          {material.title}
        </span>
        <span className="material__aff" aria-hidden="true">
          →
        </span>
      </Link>
    </li>
  );
}

export { countPhrase };
