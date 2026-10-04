import Link from "next/link";
import "@/features/academy-experience/experience.css";
import "@/styles/states-hifi.css";

/**
 * Top-level 404. The `(app)` group's not-found only catches misses INSIDE the
 * authenticated shell, so an unmatched root URL fell through to the framework
 * default — a bare "404" page with no way back into the product.
 *
 * PRODUCT HI-FI (DD-338): it stands on the product's ground with Public Home's
 * corner light, and says it in the product's language — one lit surface, the
 * statement in the display face, the ways back as pills.
 */
export default function RootNotFound() {
  return (
    <main className="ax-page">
      <div className="ax">
        <div className="ax-empty">
          <h1>Такой страницы нет</h1>
          <p>Возможно, ссылка устарела или была скопирована не полностью.</p>
          <p className="ax-actions">
            <Link className="ax-cta" href="/">На главную</Link>
            <Link className="ax-cta ax-cta--quiet" href="/path">Путь обучения</Link>
          </p>
        </div>
      </div>
    </main>
  );
}
