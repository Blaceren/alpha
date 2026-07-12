import styles from "./tradequest-prototype.module.css";

const stats = [
  { value: "12K+", label: "учеников в потоке" },
  { value: "48K", label: "проверенных действий" },
  { value: "+15 XP", label: "за регистрацию" },
];

const tasks = [
  { step: "01", title: "Pocket registration", state: "Postback required", status: "active" },
  { step: "02", title: "Первая сделка", state: "Locked until registration", status: "locked" },
  { step: "03", title: "Отчёт наставнику", state: "Review queue", status: "locked" },
];

const path = [
  { title: "Start", copy: "Регистрация, профиль и первый подтверждённый шаг." },
  { title: "Practice", copy: "Сделки, задания, отчёты и понятный прогресс." },
  { title: "Proof", copy: "Постбеки, проверки и статус без ручной путаницы." },
  { title: "Rewards", copy: "XP, уровни, доступы и мотивация возвращаться." },
];

const rows = [
  ["Alex M.", "Level 3", "1 840 XP"],
  ["Daria K.", "Level 2", "1 220 XP"],
  ["Nikita P.", "Level 2", "970 XP"],
];

export default function TradeQuestPrototypePage() {
  return (
    <div className={styles.prototype}>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <div className={styles.eyebrow}>Isolated design prototype</div>
          <h1>TradeQuest teaches trading through proof, progress, and rewards.</h1>
          <p>
            A premium dark SaaS direction for the next UI pass: strong first screen, large product preview,
            clear learning path, and focused task mechanics without touching the live product flow.
          </p>
          <div className={styles.heroActions} aria-label="Prototype-only actions">
            <span className={styles.primaryAction}>Start learning</span>
            <span className={styles.secondaryAction}>View dashboard</span>
          </div>
          <div className={styles.statsGrid}>
            {stats.map((item) => (
              <div className={styles.statCard} key={item.label}>
                <strong>{item.value}</strong>
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.dashboardPreview} aria-label="TradeQuest dashboard preview">
          <div className={styles.previewRail}>
            <div className={styles.previewLogo}>TQ</div>
            <span />
            <span />
            <span />
            <span />
          </div>
          <div className={styles.previewMain}>
            <div className={styles.previewTopbar}>
              <div>
                <span>Dashboard</span>
                <strong>Welcome back, Alex</strong>
              </div>
              <div className={styles.levelBadge}>Level 2</div>
            </div>

            <div className={styles.progressPanel}>
              <div>
                <span>Current track</span>
                <strong>Registration foundation</strong>
              </div>
              <b>65%</b>
              <div className={styles.progressBar}><span /></div>
            </div>

            <div className={styles.previewGrid}>
              <div className={styles.taskPanel}>
                <div className={styles.panelHeader}>
                  <strong>Tasks</strong>
                  <span>3 active</span>
                </div>
                {tasks.map((task) => (
                  <div className={`${styles.taskRow} ${styles[task.status]}`} key={task.step}>
                    <b>{task.step}</b>
                    <div>
                      <strong>{task.title}</strong>
                      <span>{task.state}</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className={styles.chartPanel}>
                <div className={styles.panelHeader}>
                  <strong>Learning momentum</strong>
                  <span>+24%</span>
                </div>
                <div className={styles.chartLines}>
                  <i />
                  <i />
                  <i />
                </div>
                <div className={styles.chartCurve} />
              </div>

              <div className={styles.leaderboardPanel}>
                <div className={styles.panelHeader}>
                  <strong>Leaderboard</strong>
                  <span>Weekly</span>
                </div>
                {rows.map(([name, level, xp], index) => (
                  <div className={styles.rankRow} key={name}>
                    <b>{index + 1}</b>
                    <div>
                      <strong>{name}</strong>
                      <span>{level}</span>
                    </div>
                    <em>{xp}</em>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.featureBand}>
        {[
          "Postback-first progress",
          "Trading tasks",
          "XP and levels",
          "Mentor review",
          "Rewards",
          "Community",
        ].map((item) => (
          <span key={item}>{item}</span>
        ))}
      </section>

      <section className={styles.pathSection}>
        <div className={styles.sectionHeader}>
          <span>Learning route</span>
          <h2>A structured journey that feels premium, not noisy.</h2>
        </div>
        <div className={styles.pathGrid}>
          {path.map((item, index) => (
            <article className={styles.pathCard} key={item.title}>
              <b>{String(index + 1).padStart(2, "0")}</b>
              <h3>{item.title}</h3>
              <p>{item.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.bottomSection}>
        <div className={styles.rewardCard}>
          <span>Next unlock</span>
          <h2>Private chat access</h2>
          <p>Unlocked when the learner completes verified onboarding and keeps the first activity streak alive.</p>
        </div>
        <div className={styles.consoleCard}>
          <div className={styles.consoleHeader}>
            <strong>Proof timeline</strong>
            <span>Live states</span>
          </div>
          <div className={styles.timelineItem}><b />Click id created</div>
          <div className={styles.timelineItem}><b />Registration pending</div>
          <div className={styles.timelineItem}><b />Postback completes task</div>
        </div>
      </section>
    </div>
  );
}
