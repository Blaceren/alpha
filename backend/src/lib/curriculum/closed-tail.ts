/**
 * PROGRAM STRUCTURE — the levels of a program that are defined but not open yet.
 *
 * ============================ WHAT THIS DECIDES ============================
 * A program is written faster than it is produced. The 30-level program has a
 * first chapter with lessons, videos and tests, and a second chapter that is
 * sixteen titles with one line each. Those sixteen belong on the learner's
 * path — they are what comes next — and they must not be completable, because
 * there is nothing in them to complete.
 *
 * The runtime already knew how to hold such a level shut: a definition whose
 * `status` is not `active` resolves `locked` with `definition_inactive`, cannot
 * be started, cannot be read and cannot be completed. What it did not allow was
 * PUBLISHING one. A published version could contain no disabled definition at
 * all, so a program could only ever be published whole.
 *
 * This module states the one shape in which a disabled definition is safe to
 * publish, and both guards that used to refuse every disabled definition — the
 * publication validator and the pinned-graph check in the resolver — now ask it
 * instead of answering "never".
 *
 * ================================ THE SHAPE ================================
 * A CLOSED TAIL: the first level is open, and from the first level that is not,
 * every later level is not either.
 *
 *   open open open … open | closed closed … closed
 *
 * Nothing else. A closed level with an open one behind it would lock that open
 * level for ever, because levels complete strictly in order — which is exactly
 * why a disabled definition used to be refused outright. A trailing run locks
 * nothing that could otherwise be reached.
 *
 * A MODULE may be disabled only when every level it owns is in that tail. An
 * ACTIVE module may own closed levels — a module whose first lessons are out
 * and whose last ones are still being produced.
 *
 * =========================== WHAT IT NEVER DOES ===========================
 * It reads two arrays and returns a verdict. No database, no clock, no flags.
 */

type TailLevel = {
  readonly id: number;
  readonly levelNumber: number;
  readonly moduleId: number;
  readonly status: string;
};

type TailModule = {
  readonly id: number;
  readonly status: string;
};

export type ClosedTailVerdict =
  | {
      readonly ok: true;
      /** Levels that are defined but not open. Empty for a fully open program. */
      readonly closedLevelIds: ReadonlySet<number>;
      /** Modules none of whose levels is open. */
      readonly closedModuleIds: ReadonlySet<number>;
    }
  | {
      readonly ok: false;
      /** The definitions that break the shape, for a diagnostic. */
      readonly offendingLevelIds: readonly number[];
      readonly offendingModuleIds: readonly number[];
    };

function isOpen(definition: { status: string }): boolean {
  return definition.status === "active";
}

export function describeClosedTail(
  levels: readonly TailLevel[],
  modules: readonly TailModule[],
): ClosedTailVerdict {
  const ordered = [...levels].sort(
    (left, right) => left.levelNumber - right.levelNumber || left.id - right.id,
  );
  const firstClosed = ordered.findIndex((level) => !isOpen(level));

  const offendingLevelIds: number[] = [];
  const closedLevelIds = new Set<number>();
  if (firstClosed === 0) {
    // Nothing is open at all, or the program starts shut.
    offendingLevelIds.push(ordered[0].id);
  } else if (firstClosed > 0) {
    for (const level of ordered.slice(firstClosed)) {
      if (isOpen(level)) {
        // An open level behind a closed one. The closed levels in front of it
        // are the defect: they are what makes it unreachable.
        for (const blocker of ordered.slice(firstClosed)) {
          if (!isOpen(blocker) && blocker.levelNumber < level.levelNumber) {
            if (!offendingLevelIds.includes(blocker.id)) offendingLevelIds.push(blocker.id);
          }
        }
      } else {
        closedLevelIds.add(level.id);
      }
    }
  }

  const offendingModuleIds: number[] = [];
  const closedModuleIds = new Set<number>();
  for (const moduleDefinition of modules) {
    if (isOpen(moduleDefinition)) continue;
    const owned = levels.filter((level) => level.moduleId === moduleDefinition.id);
    if (owned.length === 0 || owned.some((level) => isOpen(level))) {
      offendingModuleIds.push(moduleDefinition.id);
    } else {
      closedModuleIds.add(moduleDefinition.id);
    }
  }

  if (offendingLevelIds.length > 0 || offendingModuleIds.length > 0) {
    return { ok: false, offendingLevelIds, offendingModuleIds };
  }
  return { ok: true, closedLevelIds, closedModuleIds };
}
