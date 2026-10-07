# Mobile fixes, 2026-10-07 (DD-355)

Owner, on iPhone screenshots of PREPROD: «теперь правки для мобильной версии / Выровнять строку по левой
стороне (1 скрин) / Убрать текст "видео 10:00" — информация дублируется с видимым таймером плеера и
визуально перегружает блок и Не работает открытие видео на весь экран, в ПК версии все ок (2 скрин) /
Выровнять все кнопки по правому нижнему углу (3 скрин)». Release: by readiness.

## What changed

1. **Path, the counts** («ПРОЙДЕНО 14 ИЗ 30 УРОВНЕЙ · ОТКРЫТО 14»): below 600px they take a line of their
   own under «Путь» and start where it starts — the frozen layer pushed them right (`margin-left: auto`).
   From 600px, where they share the title's line, they stay at its right.
2. **Lesson header**: the video's length is not said in the facts rail below 900px (the mobile layout) —
   the player right under it shows the same time. The fact is marked `ld-fact--video`; the desktop keeps
   it.
3. **Full screen on an iPhone**: the player asked for element fullscreen, which Safari on an iPhone does
   not have, so the press did nothing. Where element fullscreen is not available the video now opens in
   the system's own full-screen player (`webkitEnterFullscreen`), called straight from the press; where it
   is (a computer, an iPad), the player's frame goes full screen as before.
4. **Profile → Аккаунт, the actions**: below 600px every row's action sits at the row's bottom right —
   beside the value where both fit, on its own line at the right where they do not («Написать в
   поддержку», «Выйти из аккаунта» were at the left); a form's «Сохранить»/«Сменить пароль» + «Отмена»
   and the answers to «Завершить сеанс на этом устройстве?» go right as well. The desktop is unchanged.

## Measured (stand: academy production build, synthetic learner)

- Path at 390/375/320: the counts start at 16px, the title's left edge (were 78/63px); at 768 and 1440 as
  before.
- Lesson at 390/375/320/768: facts «Завершён · проверка знаний после урока · +100 XP»; at 1440 the video's
  length is still there.
- Full screen: in a browser made like an iPhone (no element fullscreen) the press asks the video's own
  full-screen player once; in a desktop browser the frame goes full screen. A real iPhone still needs the
  owner's look — the stand cannot be an iPhone.
- Profile at 390/375/320: every action 0px from its row's right edge, 13px from its bottom (were up to
  225px from the right); a support link in the email row on its own line at the right; the password form's
  buttons at the right; at 1440 unchanged.
- Tests: player (iPhone path, desktop path, a refusal), lesson facts, Path and profile stylesheet rules.

## Captures

`design-memory/screenshots/mobile-fixes-1007/`: the owner's Path and lesson screenshots (the profile one
shows an account's name and address and is not kept), before/after at 390 for Path and the lesson,
before 375 / after 390 for the profile, the support link and the password form.
