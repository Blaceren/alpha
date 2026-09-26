import Link from "next/link";

const footerLinks = [
  { href: "/privacy", label: "Конфиденциальность" },
  { href: "/cookies", label: "Cookies" },
  { href: "/security", label: "Безопасность" },
  { href: "/support", label: "Саппорт" },
];

export function Footer() {
  return (
    <footer className="mt-10 border-t border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_88%,var(--background))]">
      <div className="app-container flex flex-col gap-4 py-6 text-sm text-[var(--text-secondary)] md:flex-row md:items-center md:justify-between">
        <p>TradeQuest · Closed-testing MVP · обучение трейдингу через задания, уровни и награды.</p>
        <nav aria-label="Правовые разделы">
          <ul className="flex flex-wrap gap-4">
            {footerLinks.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="hover:text-[var(--text-primary)]">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}
