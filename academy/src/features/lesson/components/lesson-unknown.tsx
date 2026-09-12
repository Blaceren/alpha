import Link from "next/link";
import { levelCodeFor } from "@/features/lesson/model/lesson";
import { CURRENT_LESSON_LEVEL } from "@/features/lesson/data/lesson-fixtures";

/**
 * Two honest dead-ends (Phase D2B), both reachable rather than 404:
 *
 *  - an address that is not a curriculum level at all;
 *  - a level the user HAS reached, but whose experience D2B did not build
 *    (level 19 is a practical/report level; reports arrive in a later phase).
 *
 * Neither invents a lesson, and neither pretends the level is finished.
 */
export function LessonUnknown({
  levelNumber,
  title,
  note,
}: {
  levelNumber?: number;
  title?: string;
  note?: string;
}) {
  const known = levelNumber !== undefined;

  return (
    <div className="llk">
      <Link href="/path" className="lhd-back">
        <span aria-hidden="true">←</span> Путь
      </Link>
      {known && <p className="lhd-eyebrow">Уровень {levelNumber}</p>}
      <h1 className="lhd-h1">{known ? (title ?? `Уровень ${levelNumber}`) : "Урок не найден"}</h1>

      <div className="llk-sec">
        {known ? (
          <>
            <p className="llk-k">Этот уровень ещё не построен</p>
            <ul>
              <li>{note ?? "Опыт этого уровня появится на следующем этапе разработки."}</li>
              <li>Уровень открыт по последовательности — дело не в условиях доступа.</li>
            </ul>
          </>
        ) : (
          <>
            <p className="llk-k">Такого урока нет</p>
            <ul>
              <li>Адрес не соответствует ни одному уровню пути.</li>
              <li>Уроки открываются с Пути и с Главной.</li>
            </ul>
          </>
        )}
      </div>

      <div className="lnav-row">
        <Link href="/path" className="lnav-back">
          <span aria-hidden="true">←</span> Вернуться в Путь
        </Link>
        <Link href={`/lessons/${levelCodeFor(CURRENT_LESSON_LEVEL)}`} className="lnav-next">
          Перейти к текущему уроку — уровень {CURRENT_LESSON_LEVEL}
          <span aria-hidden="true">→</span>
        </Link>
      </div>
    </div>
  );
}
