/**
 * PROFILE — narrow on purpose.
 *
 * The navigation has advertised this destination while the route did not exist.
 * It now exists and shows exactly what the Academy legitimately owns about the
 * learner: their identity in this product, and the session controls that are
 * already implemented in the shell.
 *
 * WHAT IS DELIBERATELY ABSENT. No Pocket balance, deposit or trading history —
 * the Academy is not the owner of financial truth and a profile page is the
 * easiest place for a fake one to appear. No Affiliate identity: a learner and a
 * partner are different roles in different products. No staff data. Adding any
 * of them would mean this page had quietly become a dashboard for systems that
 * have their own owners.
 */
import Link from "next/link";
import type { AcademyViewer } from "@/lib/api/viewer";
import { EmptyState } from "@/features/academy-experience/primitives";

export function ProfileScreen({ viewer }: { viewer: AcademyViewer | null }) {
  if (!viewer) {
    return (
      <EmptyState
        title="Профиль недоступен"
        message="Не удалось прочитать данные учётной записи. Обновите страницу или войдите заново."
      />
    );
  }

  return (
    <section>
      <p className="ax-coord">Учётная запись</p>
      <h1 className="ax-statement" style={{ fontSize: "clamp(24px, 3.4vw, 34px)" }}>
        {viewer.name}
      </h1>
      <p className="ax-reason">
        Это ваш профиль ученика Академии. Здесь только данные обучения — финансовые и партнёрские
        разделы живут в отдельных продуктах.
      </p>

      <div className="ax-rail">
        <div className="ax-rail__item">
          <p className="ax-rail__k">Имя</p>
          <p className="ax-rail__v">{viewer.name}</p>
        </div>
        <div className="ax-rail__item">
          <p className="ax-rail__k">Идентификатор</p>
          <p className="ax-rail__v">{viewer.id}</p>
        </div>
      </div>

      <p className="ax-reason" style={{ marginTop: 28 }}>
        Выйти из аккаунта можно в верхней панели. Если нужно изменить данные учётной записи,
        напишите в <Link className="ax-lvl__t" href="/support">поддержку</Link>.
      </p>
    </section>
  );
}
