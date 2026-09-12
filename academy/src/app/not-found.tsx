import Link from "next/link";
import "@/features/academy-experience/experience.css";

/**
 * Top-level 404. The `(app)` group's not-found only catches misses INSIDE the
 * authenticated shell, so an unmatched root URL fell through to the framework
 * default — a bare "404" page with no way back into the product.
 */
export default function RootNotFound() {
  return (
    <div className="ax">
      <div className="ax-empty">
        <h1 style={{ margin: "0 0 10px", fontSize: 22, fontWeight: 600 }}>Такой страницы нет</h1>
        <p>Возможно, ссылка устарела или была скопирована не полностью.</p>
        <p style={{ marginTop: 22, display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Link className="ax-cta" href="/">На главную</Link>
          <Link className="ax-cta ax-cta--quiet" href="/path">Путь обучения</Link>
        </p>
      </div>
    </div>
  );
}
