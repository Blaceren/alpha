# TOOLS_STORAGE — Trading Journal browser-local persistence (D4-B)

**Phase:** D4-B. **Decisions:** DD-303, DD-304, DD-305, DD-306, DD-310.
**Owner module:** `src/features/tools/model/journal-store.ts` (the only place that
touches Web Storage for tools). Model: `journal-entry.ts`. Hook:
`hooks/use-trading-journal.ts`.

This mirrors the report-store precedent (`REPORT_STORAGE.md`, DD-266): the user's
WORK must survive closing the tab, so it is `localStorage`, not `sessionStorage`.
Nothing is sent anywhere — there is no server, no broker, no Pocket sync.

---

## 1. Key & version

| Key | Version | Shape |
|-----|:------:|-------|
| `ata.tools.trading-journal.v1` | 1 | `{ version: 1; sequence: number; entries: JournalEntry[] }` |

`sequence` is a monotonic id counter (never a financial total). The next entry id
is `journal-${sequence + 1}`.

## 2. JournalEntry

```ts
interface JournalEntry {
  id: string;
  occurredAt: string;   // ISO-8601
  instrument: string;
  direction: "buy" | "sell" | "observation";
  setup: string;        // optional (may be "")
  plan: string;
  execution: string;
  lesson: string;       // the point of the entry
  manualResult: number | null;  // optional per-trade number; null is normal
  createdAt: string;
  updatedAt: string;
}
```

Direction labels: `buy → «Покупка»`, `sell → «Продажа»`,
`observation → «Наблюдение / без входа»`.

Required, non-whitespace: `occurredAt`, `instrument`, `direction`, `plan`,
`execution`, `lesson`. Optional: `setup`, `manualResult`. Bounded string limits
(`JOURNAL_LIMITS`, aligned with the report `MAX_FIELD_LENGTH = 2000`): instrument
60, setup 400, plan/execution/lesson 2000.

`manualResult` (DD-303) is a finite number or null — positive, negative or zero.
It is **not** a balance, not Pocket balance, not aggregated, not a percentage, not
bound to an account/broker, and never influences XP, levels or checkpoints.
Presented as a secondary fact: «Результат сделки, введён вручную: +18» or
«Денежный результат не указан».

## 3. Never stored (DD-303/304/305)

`accountId`, `brokerId`, account number, balance, deposit, withdrawal, P/L,
profitability, percentage, win rate, running total, equity, any aggregate, auth
token, or unrestricted arbitrary JSON. A unit test
(`journal-store.test.ts`) asserts the serialized payload and the entry key-set
contain none of these.

## 4. Parser — fail closed

`parseTradingJournal(raw): { state, corrupt }`, never throws, never returns junk:

| Input | Result | corrupt |
|-------|--------|:------:|
| null / "" / absent | empty canonical state | false |
| invalid JSON | empty | **true** |
| non-object root | empty | **true** |
| `version !== 1` (unknown) | empty | false (unsupported, not damaged) |
| v1 root, `entries` not array / bad `sequence` | empty | **true** |
| valid v1 root | normalized entries | false |

Within a valid v1 root, an individual entry is DROPPED (never partially
resurrected as real data) when it has a missing/empty required field, an invalid
ISO `occurredAt`, an unknown `direction`, a non-finite `manualResult`, or a
duplicate id (first wins). The `sequence` is advanced past the highest surviving
`journal-N` id so a new id can never collide.

`corrupt: true` drives the UI's calm corrupt-storage fallback (empty workspace +
explanation, never the raw payload).

## 5. Store ports

- `BrowserLocalJournalStore` (durable) — the origin's localStorage. `write` builds
  the full serialized value BEFORE `setItem`; a throw (quota / blocked / private
  mode) returns `false` and never claims success. A `getItem` throw degrades to
  empty (unavailability, `corrupt: false`).
- `MemoryJournalStore` (not durable) — server / no-storage environments; honest
  `durable: false`.
- `createTradingJournalStore()` — browser store when localStorage is usable, else
  the memory store (SSR renders empty; the client re-resolves after hydration).

## 6. Hook & save states

`useTradingJournal()` takes the persisted read through `useSyncExternalStore`
(server snapshot empty → no hydration mismatch) and layers an in-memory `local`
state on top. A LANDED write advances `local`; a FAILED write leaves `local`
untouched (the entry is not added), raises `storage-error`, and the form keeps the
draft for retry. Save states: `idle · pending · saved · storage-error` (plus the
component-owned `editing`, and the read-time `corrupt` fallback).

CRUD in D4-B: create / read-list / edit only (no delete, restore, duplicate, bulk,
import/export, tags, filter, search, pagination, statistics, charts). Create is an
explicit action, one entry per submit, double-submit guarded, canonical reread
after success. Edit is inline, one at a time; Cancel/Escape discard the draft;
`updatedAt` bumps only after a landed write. List is newest `occurredAt` first
with a stable id tie-break.

## 7. Future API boundary (not implemented)

When a backend exists (not in D4), tools availability will come from the same
progression contract as levels, and journal entries from this browser-local store
with optional later server sync. No tools endpoint accepts or returns a balance,
deposit, P/L aggregate or broker sync; the manual per-trade number stays a field
of a single entry and is never summed. See `D4_TOOLS_SCOPE.md` §11.
