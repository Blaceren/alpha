# Public Home header, signed in, on a phone (DD-359), 2026-10-07

Owner: «так же на мобильной версии в шапке сделай кнопку как на десктопе в случае того что залогинен кнопка
перейти в академию а не вход». Release: by readiness.

## Before

Up to 1040px the header shows the wordmark, «Войти» and «Меню». Signed in, «Войти» was omitted and nothing
took its place: the way into the Academy («Перейти в Академию» → /home) was only inside the menu, and there
it sat alone in the left, narrower column of the menu's two-column action row.

## After

- Signed in, beside «Меню», the desktop's own call to action: the signal button «Перейти в Академию» → /home
  (`button button--small button--signal mobile-academy`, 44px, 14px sides).
- Up to 359px it reads «В Академию» (its accessible name stays «Перейти в Академию»): the pill's content is
  269px at 320 and the full words need 299; from 360 they fit. Declared on the 359px phone-trim step.
- The pill's minimum gap between the wordmark and the actions is 12px up to 680px (was 28): the pill spreads
  its ends apart anyway, so a visitor's header does not move by a pixel.
- In the open menu the single «Перейти в Академию» takes the whole row.
- Signed out, nothing changed.

## Measured (stand: production build, a synthetic learner of the scratch database)

- 320/340/359: «В Академию», 102px, 6px before «Меню», inside the pill, one line.
- 360/375/390/414/680/768/1024: «Перейти в Академию», 153px, one line, 6–8px before «Меню».
- 1041/1440: the desktop header as before (163px button in the bar).
- Open menu at 320 and 390: the action row and its one button are the same width (266/336px).
- No horizontal page overflow at any width. Signed out, every header box at 320/360/390/768/1024/1440 is
  identical to the live PREPROD page.

Captures: `design-memory/screenshots/public-header-member/`.
