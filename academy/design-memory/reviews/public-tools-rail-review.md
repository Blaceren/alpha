# Public Home, the tools rail on a phone (DD-356)

Owner, 2026-10-07, on an iPhone screenshot of PREPROD's Public Home: «Баг во время переключения название
инструмента пропадает и появляется / А так же кружки с номером уровня нужно подсветить что бы интуитивно
было понятно что можно по ним нажимать и в целом на этом экране было понятно что тут рассказываем про
инструменты, показываем что они открываются на определенном уровне и можно выбрать уровень и посмотреть
превью». Release: by readiness. Design: delegated.

## The bug, measured

`probe.cjs` (390, touch), the note under the rail and each card's tool name, frame by frame:
- a press on L24: «Trade Card» → «Personal Stats» (the press) → back to «Trade Card» (the deck had not moved
  yet) → «Trading Journal» → «Risk Calculator» → «Entry Checklist» → «Personal Stats», and every card the
  deck slid past lit up and dimmed again;
- a swipe back: the note named every card on the way.

Cause: the card on show was read on every frame of the deck's scroll. Now it is read when the deck comes to
rest (`scrollend`, or 120ms without a scroll event); a press names its tool at once. After: the press goes
«Trade Card» → «Personal Stats» once, only those two cards change; a swipe names its card once, at rest.

## Directions weighed (the rail)

| | A «Рейка, которая объясняет себя» (chosen) | B «Вкладки с названиями» | C «Пульс следующего» |
|---|---|---|---|
| Form | a line above the rail saying what it is for; every level a lit ring with a glow; the level in the note in the Signal | chips with tool names instead of level circles | the next circle pulses to invite a press |
| Why not | — | six names do not fit a phone, and the levels — the point — are lost | motion as the only cue; distracting, nothing for reduced motion |

## What changed (narrow screens only; the desktop has no rail)

- «Нажмите на уровень, чтобы посмотреть превью инструмента» above the rail, after a Signal point.
- Every level: a 1.5px Signal ring at 50%, a faint light inside, a soft glow, the number in white; the one
  on show filled as before; a press pushes it in (scale 0.93).
- The note: «Trade Card — открывается на уровне **5**», the level in the Signal.

## Measured

390/375/320/768: the hint shown, six 44px levels each hit at its centre, no sideways scroll; 1440: no rail,
unchanged. Tests: the hint, the note named once through a press's glide and once at the end of a swipe,
the rail's button styling.
