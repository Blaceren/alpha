# The player's sound on a phone, and the film on the Public Home (DD-361), 2026-10-07

Owner: «в плеере на моб нельзя регулировать громкость нужно это исправить и проверить на проблемы и на
внешней главной поставить плеер так же с черным экраном на 5 секунд что бы после просто заменить видео».
Release by readiness.

## What was wrong

1. Up to 620px the whole sound control (`.avp__volume`) was `display: none` — «Volume is the device's own
   buttons on a phone». A phone had no way to mute, let alone set the level.
2. With a film file in place, the hero's stage stayed 16:9 with `overflow: hidden` while the player is the
   picture AND a bar under it: the bar was 96–100px below the stage's edge — a visitor who pressed play had no
   pause, no sound, no full screen (never seen before: there was no film file).
3. On the Public Home the player read the page's `--text-primary` (Ink, for the page's light surfaces): the
   bar's icons were Ink on Ink, all but invisible.
4. The ended screen of the film said «Урок просмотрен».
5. In full screen on a phone, a tap while the controls had stepped aside paused the video instead of only
   bringing the controls back.
6. On a 320px phone (and in the hero's 248px stage) the control row ran off the player's edge: the full-screen
   button was unreachable.

## What changed

- The speaker is in the bar on every width. Where the bar is wide, the level sits beside it as before. On a
  narrow bar (≤620px, the same width the stylesheet folds at) the speaker opens the level in a window just above
  the bar, at its right: the speaker's own mute, the level, the figure. It closes on a press elsewhere, on Escape,
  and when the speaker is pressed again.
- An iPhone (and an iPad) does not let a page set the level — `volume` reads 1 whatever is written. Asked once
  of a media element and read through `useSyncExternalStore` (the server's «yes» stands until hydration): there
  the speaker only mutes and unmutes, and no slider that would move nothing is drawn.
- The control row may take two lines on the narrowest players (right group `margin-left: auto`); nothing runs
  off the edge.
- Full screen on a phone: a touch while the controls are away only reveals them (`swallowClickRef`).
- Hero: `data-watching` on the stage → `aspect-ratio: auto`, the player's own height; the player gets
  `--text-primary/--text-secondary` of the dark surface; `endedEyebrow="Фильм просмотрен"`.
- The film placeholder: a 5-second black 1280×720 VP8/WebM (`hero.webm`, 96 KB, made with Playwright's ffmpeg
  from black frames — the server has no ffmpeg). `hero.mp4`, when the owner copies it in, takes precedence by
  the reader's order; the webm is then to be removed.

## Measured (stand, production build)

Hero, playing: bar inside the stage at 320/390/768/1440 (1px above its edge); icons rgb(243,244,239).
Narrow bar: 320 — two lines, no overflow, the level's window 214px, 4px above the bar, in view; 390 (hero's
320px stage) — two lines; lesson player 390/430 — one line with the speaker; 768/1440 — inline slider. A tap at a
quarter of the window's slider → 0.2 / «20%»; a tap outside closes it. The clip: 5.0s, 1280×720, served as
video/webm. Ended: «Фильм просмотрен · Как устроена Alpha Trade Academy · Смотреть снова». Tests 3339/3339,
lint, types. An iPhone itself still needs the owner's look — the stand cannot be one.

Captures: `design-memory/screenshots/player-sound-film/`.
