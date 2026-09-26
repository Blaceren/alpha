"use client";

/**
 * Personal Stats' presentational parts: the period, the four figures, the
 * win rate on plan against a broken plan, and the rules broken. No state and no
 * effects; the workspace owns both.
 */
import { Info } from "lucide-react";
import {
  MIN_GROUP_TRADES,
  STATS_PERIODS,
  againstBreakEven,
  ofWords,
  payoutWords,
  preciseWords,
  rateWords,
  sampleWords,
  tradesWords,
  type JournalStats,
  type StatsPeriod,
  type WinRate,
} from "./stats-model";

/* ------------------------------------------------------------- the period */

/** Never disabled while a window loads: a control that disables itself drops the focus. */
export function StatsPeriodBar({
  period,
  onChange,
}: {
  period: StatsPeriod;
  onChange: (period: StatsPeriod) => void;
}) {
  return (
    <div className="jr-filters st-periods" role="group" aria-label="Период">
      {STATS_PERIODS.map((option) => (
        <button
          key={option.value}
          type="button"
          className="jr-filter"
          aria-pressed={period === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------- the tiles */

/** The presentation's four figures, each with what it is made of. */
export function StatsFigures({ stats }: { stats: JournalStats }) {
  return (
    <dl className="st-figures">
      <div className="st-figure">
        <dt className="st-figure__label">Сделок</dt>
        <dd className="st-figure__value">{stats.trades}</dd>
        <dd className="st-figure__basis">в журнале</dd>
      </div>
      <div className="st-figure">
        <dt className="st-figure__label">Win rate</dt>
        <dd className="st-figure__value">{rateWords(stats.winRateBasisPoints)}</dd>
        <dd className="st-figure__basis">{ofWords(stats.wins, stats.trades)}</dd>
      </div>
      <div className="st-figure">
        <dt className="st-figure__label">Безубыточность</dt>
        <dd className="st-figure__value">{preciseWords(stats.breakEvenBasisPoints)}</dd>
        <dd className="st-figure__basis">при среднем payout {payoutWords(stats.averagePayoutTenths)}</dd>
      </div>
      <div className="st-figure">
        <dt className="st-figure__label">По плану</dt>
        <dd className="st-figure__value">{rateWords(stats.onPlanBasisPoints)}</dd>
        <dd className="st-figure__basis">
          {ofWords(stats.onPlan, stats.trades)}
          {stats.unmarked > 0 ? ` · ${stats.unmarked} без отметки` : ""}
        </dd>
      </div>
    </dl>
  );
}

export function StatsSample({ stats }: { stats: JournalStats }) {
  if (!stats.preliminary) return null;
  return (
    <p className="tc-note st-sample">
      <Info aria-hidden="true" size={14} strokeWidth={1.75} />
      <span>{sampleWords(stats.trades)}</span>
    </p>
  );
}

/* --------------------------------------------------------------- the split */

/**
 * THE SIGNATURE: the win rate on plan against the win rate with a broken plan,
 * each on a 0–100% track with break-even marked across both. Above the mark the
 * plan earns on average, below it it loses; the words say the same.
 */
export function StatsSplit({ stats }: { stats: JournalStats }) {
  const breakEven = stats.breakEvenBasisPoints;
  return (
    <section className="tc-section st-split" aria-labelledby="st-split-title">
      <div className="tc-section__head">
        <h2 className="tc-section__title" id="st-split-title">
          Win rate и соблюдение плана
        </h2>
        {breakEven !== null ? <span className="st-split__mark-label">отметка — безубыточность {preciseWords(breakEven)}</span> : null}
      </div>
      <SplitRow name="План соблюдён" group={stats.split.followed} breakEven={breakEven} />
      <SplitRow name="План нарушен" group={stats.split.broken} breakEven={breakEven} />
      {stats.unmarked > 0 ? (
        <p className="tc-caption">
          {tradesWords(stats.unmarked)} без отметки плана в разделение не входят — отметьте их в журнале.
        </p>
      ) : null}
    </section>
  );
}

function SplitRow({ name, group, breakEven }: { name: string; group: WinRate; breakEven: number | null }) {
  const standing = againstBreakEven(group, breakEven);
  return (
    <div className="st-row" data-standing={standing ?? undefined}>
      <div className="st-row__head">
        <span className="st-row__name">{name}</span>
        <span className="st-row__value">
          {group.trades === 0 ? "нет сделок" : `${rateWords(group.winRateBasisPoints)} · ${ofWords(group.wins, group.trades)}`}
        </span>
      </div>
      <span className="st-track" aria-hidden="true">
        {group.winRateBasisPoints !== null ? (
          <span className="st-track__fill" style={{ width: `${group.winRateBasisPoints / 100}%` }} />
        ) : null}
        {breakEven !== null ? <span className="st-track__mark" style={{ left: `${breakEven / 100}%` }} /> : null}
      </span>
      {standing === "few" ? (
        <span className="st-row__few">Меньше {MIN_GROUP_TRADES} сделок — рано делать вывод.</span>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------ the rules */

export function StatsViolations({ stats }: { stats: JournalStats }) {
  const { total, items } = stats.violations;
  const top = items[0]?.count ?? 0;
  return (
    <section className="tc-section st-rules" aria-labelledby="st-rules-title">
      <div className="tc-section__head">
        <h2 className="tc-section__title" id="st-rules-title">
          Нарушения
        </h2>
        <span className="st-rules__total">{total}</span>
      </div>
      {items.length === 0 ? (
        <p className="tc-caption">Нарушений не отмечено.</p>
      ) : (
        <ol className="st-rules__list">
          {items.map((item) => (
            <li className="st-rule" key={item.code}>
              <span className="st-rule__label">{item.label}</span>
              <span className="st-rule__count">{item.count}</span>
              <span className="st-rule__bar" aria-hidden="true">
                <span className="st-rule__fill" style={{ width: `${top === 0 ? 0 : (item.count / top) * 100}%` }} />
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
