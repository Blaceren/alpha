import fs from "node:fs/promises";
import path from "node:path";

const projectRoot = process.cwd();
const visualQaRoot = path.join(projectRoot, "visual-qa");
const screenshotsRoot = path.join(visualQaRoot, "screenshots");
const outputPath = path.join(visualQaRoot, "index.html");
const summaryPath = path.join(visualQaRoot, "summary.json");

const themeOrder = ["light", "dark"];
const viewportOrder = ["desktop", "tablet", "mobile"];
const criticalRoutes = [
  "/",
  "/dashboard",
  "/tasks",
  "/exchange",
  "/chat",
  "/admin",
  "/admin/users",
  "/admin/exchange",
  "/support",
];
const checklistItems = [
  "Readable text",
  "No horizontal overflow",
  "No broken cards",
  "No broken tables",
  "No bad contrast",
  "No old white/slate blocks in dark theme",
  "CTA visible",
  "Mobile usable",
  "Spacing consistent",
];
const routeByName: Record<string, string> = {
  home: "/",
  login: "/login",
  register: "/register",
  privacy: "/privacy",
  cookies: "/cookies",
  security: "/security",
  dashboard: "/dashboard",
  tasks: "/tasks",
  levels: "/levels",
  rewards: "/rewards",
  "rewards-daily": "/rewards/daily",
  leaderboard: "/leaderboard",
  achievements: "/achievements",
  chat: "/chat",
  "mentor-chat": "/mentor-chat",
  notifications: "/notifications",
  exchange: "/exchange",
  "exchange-existing-account": "/exchange/existing-account",
  feedback: "/feedback",
  admin: "/admin",
  "admin-users": "/admin/users",
  "admin-tasks": "/admin/tasks",
  "admin-rewards": "/admin/rewards",
  "admin-promocodes": "/admin/promocodes",
  "admin-achievements": "/admin/achievements",
  "admin-news": "/admin/news",
  "admin-task-reports": "/admin/task-reports",
  "admin-exchange": "/admin/exchange",
  "admin-feedback": "/admin/feedback",
  "admin-chat-moderation": "/admin/chat-moderation",
  "admin-audit-logs": "/admin/audit-logs",
  support: "/support",
  crm: "/crm",
  "open-questions": "/open-questions",
};

type Screenshot = {
  theme: string;
  viewport: string;
  route: string;
  routeName: string;
  filePath: string;
};

type VisualQaSummary = {
  generatedAt?: string;
  baseUrl?: string;
  results?: Array<{
    theme?: string;
    viewport?: string;
    route?: string;
    screenshot?: string;
    ok?: boolean;
    warnings?: string[];
  }>;
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function routeFromName(routeName: string) {
  return routeByName[routeName] ?? `/${routeName}`;
}

function sortByOrder(value: string, order: string[]) {
  const index = order.indexOf(value);
  return index === -1 ? order.length : index;
}

async function findPngFiles(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return findPngFiles(entryPath);
      return entry.isFile() && entry.name.toLowerCase().endsWith(".png") ? [entryPath] : [];
    }),
  );
  return files.flat();
}

async function readSummary() {
  try {
    return JSON.parse(await fs.readFile(summaryPath, "utf8")) as VisualQaSummary;
  } catch {
    return null;
  }
}

function buildHtml(screenshots: Screenshot[], summary: VisualQaSummary | null) {
  const themes = [...new Set(screenshots.map((item) => item.theme))].sort(
    (a, b) => sortByOrder(a, themeOrder) - sortByOrder(b, themeOrder) || a.localeCompare(b),
  );
  const viewports = [...new Set(screenshots.map((item) => item.viewport))].sort(
    (a, b) => sortByOrder(a, viewportOrder) - sortByOrder(b, viewportOrder) || a.localeCompare(b),
  );
  const routes = [...new Set(screenshots.map((item) => item.route))].sort();
  const summaryResults = summary?.results ?? [];
  const warningCount = summaryResults.filter((item) => item.ok === false).length;
  const skippedCount = summaryResults.filter((item) => !item.screenshot).length;
  const generatedAt = new Date().toISOString();

  const countsByTheme = themes.map((theme) => ({
    name: theme,
    count: screenshots.filter((item) => item.theme === theme).length,
  }));
  const countsByViewport = viewports.map((viewport) => ({
    name: viewport,
    count: screenshots.filter((item) => item.viewport === viewport).length,
  }));

  const filterButtons = (kind: "theme" | "viewport", values: string[]) =>
    values
      .map(
        (value) =>
          `<button class="filter-button is-active" type="button" data-filter-kind="${kind}" data-filter-value="${escapeHtml(value)}" aria-pressed="true">${escapeHtml(value)}</button>`,
      )
      .join("");

  const criticalLinks = criticalRoutes
    .map((route) => `<button class="route-link" type="button" data-route-link="${escapeHtml(route)}">${escapeHtml(route)}</button>`)
    .join("");

  const groupLinks = themes
    .flatMap((theme) =>
      viewports.map(
        (viewport) =>
          `<a href="#group-${escapeHtml(theme)}-${escapeHtml(viewport)}">${escapeHtml(theme)} / ${escapeHtml(viewport)}</a>`,
      ),
    )
    .join("");

  const groups = themes
    .flatMap((theme) =>
      viewports.map((viewport) => {
        const items = screenshots.filter((item) => item.theme === theme && item.viewport === viewport);
        if (items.length === 0) return "";
        const cards = items
          .map((item) => {
            const summaryItem = summaryResults.find(
              (result) =>
                result.theme === item.theme && result.viewport === item.viewport && result.route === item.route,
            );
            const warnings = summaryItem?.warnings ?? [];
            const status =
              summaryItem == null
                ? `<span class="status status-neutral">No result</span>`
                : summaryItem.ok
                  ? `<span class="status status-clean">Clean</span>`
                  : `<span class="status status-warning">${warnings.length} warning${warnings.length === 1 ? "" : "s"}</span>`;
            const warningText =
              warnings.length > 0 ? `<p class="warning-text">${escapeHtml(warnings.join(", "))}</p>` : "";

            return `<article class="shot-card" data-theme="${escapeHtml(item.theme)}" data-viewport="${escapeHtml(item.viewport)}" data-route="${escapeHtml(item.route)}" data-search="${escapeHtml(`${item.route} ${item.routeName} ${item.filePath}`.toLowerCase())}">
  <a class="image-link" href="${escapeHtml(item.filePath)}" target="_blank" rel="noreferrer">
    <img src="${escapeHtml(item.filePath)}" alt="${escapeHtml(`${item.route} in ${item.theme} theme at ${item.viewport} viewport`)}" loading="lazy">
  </a>
  <div class="shot-meta">
    <div class="shot-title"><strong>${escapeHtml(item.route)}</strong>${status}</div>
    <div class="badges"><span>${escapeHtml(item.theme)}</span><span>${escapeHtml(item.viewport)}</span></div>
    <a class="file-path" href="${escapeHtml(item.filePath)}" target="_blank" rel="noreferrer">${escapeHtml(item.filePath)}</a>
    ${warningText}
  </div>
</article>`;
          })
          .join("");

        return `<section class="shot-group" id="group-${escapeHtml(theme)}-${escapeHtml(viewport)}" data-group-theme="${escapeHtml(theme)}" data-group-viewport="${escapeHtml(viewport)}">
  <div class="group-heading">
    <h2>${escapeHtml(theme)} / ${escapeHtml(viewport)}</h2>
    <span class="group-count">${items.length} screenshots</span>
  </div>
  <div class="shot-grid">${cards}</div>
</section>`;
      }),
    )
    .join("");

  const checklist = checklistItems
    .map(
      (item, index) =>
        `<label class="check-item"><input type="checkbox" data-check-index="${index}"><span>${escapeHtml(item)}</span></label>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Visual QA Gallery</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f4f6f8;
      --surface: #ffffff;
      --surface-subtle: #eef2f5;
      --text: #182026;
      --muted: #5b6670;
      --border: #cfd7de;
      --accent: #126b58;
      --accent-soft: #d8eee8;
      --warning: #9a4d00;
      --warning-soft: #fff0d8;
      --shadow: 0 2px 10px rgba(24, 32, 38, 0.08);
    }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.45 Arial, sans-serif; }
    button, input { font: inherit; }
    button:focus-visible, input:focus-visible, a:focus-visible { outline: 3px solid #4d90fe; outline-offset: 2px; }
    .page-header { position: sticky; top: 0; z-index: 10; border-bottom: 1px solid var(--border); background: rgba(244, 246, 248, 0.96); backdrop-filter: blur(10px); }
    .header-inner, main { width: min(1600px, calc(100% - 32px)); margin: 0 auto; }
    .header-inner { padding: 16px 0; }
    .title-row { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; }
    h1, h2 { margin: 0; letter-spacing: 0; }
    h1 { font-size: 24px; }
    h2 { font-size: 18px; }
    .generated { color: var(--muted); font-size: 12px; }
    .summary { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    .summary span, .badges span, .status { display: inline-flex; align-items: center; min-height: 26px; padding: 3px 8px; border: 1px solid var(--border); border-radius: 4px; background: var(--surface); }
    .toolbar { display: grid; grid-template-columns: minmax(220px, 1fr) auto auto; gap: 12px; margin-top: 12px; }
    .search { width: 100%; height: 38px; border: 1px solid var(--border); border-radius: 4px; padding: 0 11px; background: var(--surface); color: var(--text); }
    .filter-set { display: flex; gap: 6px; }
    .filter-button, .route-link { min-height: 38px; border: 1px solid var(--border); border-radius: 4px; padding: 7px 11px; background: var(--surface); color: var(--text); cursor: pointer; }
    .filter-button.is-active { border-color: var(--accent); background: var(--accent-soft); color: #0a4d3e; }
    main { padding: 20px 0 48px; }
    .review-panel { display: grid; grid-template-columns: minmax(0, 1fr) minmax(300px, 0.7fr); gap: 16px; margin-bottom: 20px; }
    .panel { border: 1px solid var(--border); border-radius: 6px; background: var(--surface); padding: 14px; box-shadow: var(--shadow); }
    .panel h2 { margin-bottom: 10px; }
    .quick-links, .group-links { display: flex; flex-wrap: wrap; gap: 7px; }
    .group-links { margin-top: 12px; }
    .group-links a { color: var(--accent); }
    .checklist { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px 12px; }
    .check-item { display: flex; align-items: flex-start; gap: 8px; }
    .check-item input { width: 17px; height: 17px; margin: 1px 0 0; accent-color: var(--accent); }
    .check-actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 12px; }
    .check-progress { color: var(--muted); }
    .reset-button { border: 0; background: transparent; color: var(--accent); cursor: pointer; padding: 4px; }
    .shot-group { scroll-margin-top: 150px; margin-top: 24px; }
    .group-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
    .group-count { color: var(--muted); }
    .shot-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; }
    .shot-card { min-width: 0; overflow: hidden; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); box-shadow: var(--shadow); }
    .image-link { display: block; aspect-ratio: 16 / 10; overflow: hidden; background: var(--surface-subtle); border-bottom: 1px solid var(--border); }
    .image-link img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: top; transition: transform 160ms ease; }
    .image-link:hover img { transform: scale(1.015); }
    .shot-meta { padding: 11px; }
    .shot-title { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .shot-title strong { font-size: 15px; overflow-wrap: anywhere; }
    .status { flex: none; min-height: 24px; font-size: 12px; }
    .status-clean { border-color: #8ac7b7; background: var(--accent-soft); color: #0a4d3e; }
    .status-warning { border-color: #e2a85f; background: var(--warning-soft); color: var(--warning); }
    .status-neutral { background: var(--surface-subtle); color: var(--muted); }
    .badges { display: flex; gap: 6px; margin-top: 9px; }
    .badges span { min-height: 22px; padding: 2px 6px; background: var(--surface-subtle); font-size: 12px; }
    .file-path { display: block; margin-top: 9px; color: var(--accent); font: 12px/1.4 Consolas, monospace; overflow-wrap: anywhere; }
    .warning-text { margin: 8px 0 0; color: var(--warning); font-size: 12px; }
    .empty-state { display: none; padding: 30px; border: 1px dashed var(--border); border-radius: 6px; background: var(--surface); text-align: center; color: var(--muted); }
    .is-hidden { display: none !important; }
    @media (max-width: 900px) {
      .toolbar, .review-panel { grid-template-columns: 1fr; }
      .filter-set { flex-wrap: wrap; }
      .page-header { position: static; }
      .shot-group { scroll-margin-top: 16px; }
    }
    @media (max-width: 560px) {
      .header-inner, main { width: min(100% - 20px, 1600px); }
      .title-row { align-items: flex-start; flex-direction: column; gap: 4px; }
      .checklist { grid-template-columns: 1fr; }
      .shot-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <header class="page-header">
    <div class="header-inner">
      <div class="title-row">
        <h1>Visual QA Gallery</h1>
        <span class="generated">Gallery generated ${escapeHtml(generatedAt)}</span>
      </div>
      <div class="summary">
        <span><strong id="visible-count">${screenshots.length}</strong>&nbsp;/ ${screenshots.length} screenshots</span>
        <span>${routes.length} routes</span>
        ${countsByTheme.map((item) => `<span>${escapeHtml(item.name)}: ${item.count}</span>`).join("")}
        ${countsByViewport.map((item) => `<span>${escapeHtml(item.name)}: ${item.count}</span>`).join("")}
        ${summary ? `<span>Automated warnings: ${warningCount}</span><span>Skipped: ${skippedCount}</span>` : `<span>No summary.json loaded</span>`}
      </div>
      <div class="toolbar">
        <input class="search" id="route-search" type="search" placeholder="Filter by route or file path" aria-label="Filter screenshots by route or file path">
        <div class="filter-set" aria-label="Theme filters">${filterButtons("theme", themes)}</div>
        <div class="filter-set" aria-label="Viewport filters">${filterButtons("viewport", viewports)}</div>
      </div>
    </div>
  </header>
  <main>
    <section class="review-panel">
      <div class="panel">
        <h2>Quick navigation</h2>
        <div class="quick-links">${criticalLinks}</div>
        <nav class="group-links" aria-label="Screenshot groups">${groupLinks}</nav>
      </div>
      <div class="panel">
        <h2>Manual visual checklist</h2>
        <div class="checklist">${checklist}</div>
        <div class="check-actions">
          <span class="check-progress" id="check-progress">0 / ${checklistItems.length} checked</span>
          <button class="reset-button" id="reset-checklist" type="button">Reset checklist</button>
        </div>
      </div>
    </section>
    <div class="empty-state" id="empty-state">No screenshots match the current filters.</div>
    ${groups}
  </main>
  <script>
    (() => {
      const active = {
        theme: new Set(${JSON.stringify(themes)}),
        viewport: new Set(${JSON.stringify(viewports)}),
      };
      const cards = [...document.querySelectorAll(".shot-card")];
      const groups = [...document.querySelectorAll(".shot-group")];
      const search = document.querySelector("#route-search");
      const visibleCount = document.querySelector("#visible-count");
      const emptyState = document.querySelector("#empty-state");
      let exactRoute = "";

      function applyFilters() {
        const query = search.value.trim().toLowerCase();
        let visible = 0;
        for (const card of cards) {
          const matches =
            active.theme.has(card.dataset.theme) &&
            active.viewport.has(card.dataset.viewport) &&
            (exactRoute ? card.dataset.route === exactRoute : !query || card.dataset.search.includes(query));
          card.classList.toggle("is-hidden", !matches);
          if (matches) visible += 1;
        }
        for (const group of groups) {
          const hasVisibleCards = [...group.querySelectorAll(".shot-card")].some((card) => !card.classList.contains("is-hidden"));
          group.classList.toggle("is-hidden", !hasVisibleCards);
        }
        visibleCount.textContent = String(visible);
        emptyState.style.display = visible === 0 ? "block" : "none";
      }

      document.querySelectorAll("[data-filter-kind]").forEach((button) => {
        button.addEventListener("click", () => {
          const kind = button.dataset.filterKind;
          const value = button.dataset.filterValue;
          const values = active[kind];
          values.has(value) ? values.delete(value) : values.add(value);
          button.classList.toggle("is-active", values.has(value));
          button.setAttribute("aria-pressed", String(values.has(value)));
          applyFilters();
        });
      });
      search.addEventListener("input", () => {
        exactRoute = "";
        applyFilters();
      });
      document.querySelectorAll("[data-route-link]").forEach((button) => {
        button.addEventListener("click", () => {
          exactRoute = button.dataset.routeLink;
          search.value = exactRoute;
          applyFilters();
          document.querySelector(".shot-group:not(.is-hidden)")?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      });

      const checklistKey = "visual-qa-gallery-checklist-v1";
      const checks = [...document.querySelectorAll("[data-check-index]")];
      const progress = document.querySelector("#check-progress");
      function updateChecklist() {
        const state = checks.map((check) => check.checked);
        try {
          localStorage.setItem(checklistKey, JSON.stringify(state));
        } catch {}
        progress.textContent = state.filter(Boolean).length + " / " + checks.length + " checked";
      }
      try {
        const saved = JSON.parse(localStorage.getItem(checklistKey) || "[]");
        checks.forEach((check, index) => { check.checked = saved[index] === true; });
      } catch {}
      checks.forEach((check) => check.addEventListener("change", updateChecklist));
      document.querySelector("#reset-checklist").addEventListener("click", () => {
        checks.forEach((check) => { check.checked = false; });
        updateChecklist();
      });
      updateChecklist();
      applyFilters();
    })();
  </script>
</body>
</html>`;
}

async function run() {
  let pngFiles: string[];
  try {
    pngFiles = await findPngFiles(screenshotsRoot);
  } catch {
    throw new Error(`Screenshots directory not found: ${path.relative(projectRoot, screenshotsRoot)}`);
  }

  if (pngFiles.length === 0) {
    throw new Error(`No PNG screenshots found in ${path.relative(projectRoot, screenshotsRoot)}`);
  }

  const screenshots = pngFiles
    .map((filePath): Screenshot => {
      const relativeFromScreenshots = path.relative(screenshotsRoot, filePath);
      const [theme = "unknown", viewport = "unknown"] = relativeFromScreenshots.split(path.sep);
      const routeName = path.basename(filePath, path.extname(filePath));
      return {
        theme,
        viewport,
        route: routeFromName(routeName),
        routeName,
        filePath: path.relative(visualQaRoot, filePath).split(path.sep).join("/"),
      };
    })
    .sort(
      (a, b) =>
        sortByOrder(a.theme, themeOrder) - sortByOrder(b.theme, themeOrder) ||
        sortByOrder(a.viewport, viewportOrder) - sortByOrder(b.viewport, viewportOrder) ||
        a.route.localeCompare(b.route),
    );

  const summary = await readSummary();
  await fs.mkdir(visualQaRoot, { recursive: true });
  await fs.writeFile(outputPath, buildHtml(screenshots, summary), "utf8");

  const themeCounts = Object.fromEntries(
    [...new Set(screenshots.map((item) => item.theme))].map((theme) => [
      theme,
      screenshots.filter((item) => item.theme === theme).length,
    ]),
  );
  const viewportCounts = Object.fromEntries(
    [...new Set(screenshots.map((item) => item.viewport))].map((viewport) => [
      viewport,
      screenshots.filter((item) => item.viewport === viewport).length,
    ]),
  );

  console.log(`VISUAL_QA_GALLERY_DONE: ${screenshots.length} screenshots`);
  console.log(`Themes: ${JSON.stringify(themeCounts)}`);
  console.log(`Viewports: ${JSON.stringify(viewportCounts)}`);
  console.log(`Output: ${path.relative(projectRoot, outputPath)}`);
}

run().catch((error) => {
  console.error(`VISUAL_QA_GALLERY_FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
