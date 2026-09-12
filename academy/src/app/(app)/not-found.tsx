import Link from "next/link";
import "@/features/academy-experience/experience.css";

/** A dead end is still a product state: it says where to go, not just what failed. */
export default function NotFound() {
  return (
    <div className="ax">
      <div className="ax-empty">
        <h2>Такой страницы нет</h2>
        <p>Возможно, ссылка устарела. Вернитесь к текущему шагу обучения или откройте путь программы.</p>
        <p style={{ marginTop: 22, display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Link className="ax-cta" href="/">На главную</Link>
          <Link className="ax-cta ax-cta--quiet" href="/path">Путь обучения</Link>
        </p>
      </div>
    </div>
  );
}
