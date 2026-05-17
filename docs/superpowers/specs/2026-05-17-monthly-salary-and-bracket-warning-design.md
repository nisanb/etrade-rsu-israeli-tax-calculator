# Monthly salary input + bracket-crossing warning

## Problem

Today the popup has a single "Income already taxed this year (₪)" (YTD) field used in bracket mode to start RSU income from the user's real marginal rate. Two pain points:

1. Users have to mentally compute YTD = monthly_gross × months_elapsed. Easy to forget to update.
2. When a sale pushes the user from, say, the 31% bracket into the 35% bracket, nothing in the UI calls that out.

## Goal

- Let the user enter a single number — monthly gross salary — and have YTD computed automatically.
- Show a clear warning when the chosen sale crosses one or more tax brackets, so the user can decide whether to split the sale across tax years.

## Non-goals

- Flat mode behavior is unchanged — flat mode has no concept of bracket stacking. The new field and the warning only apply to bracket mode.
- No change to `calculator.js` math (no new bracket logic, no new tax rules).
- No multi-month / multi-year planning UI. Just current-year YTD.

## Settings changes

Two new keys in `chrome.storage.sync` (and mirrored in `STORAGE_DEFAULTS` / `DEFAULTS`):

| Key | Type | Default | Purpose |
|---|---|---|---|
| `monthlySalaryILS` | number | `0` | User's gross monthly IL salary in ₪ |
| `useMonthlySalary` | boolean | `false` | When true, YTD is auto-computed and the YTD field is read-only |

Existing `ytdTaxableIncomeILS` stays; it's now one of two ways to set the bracket-mode starting income.

## Popup UI (bracket-mode card only)

New block, added inside `#bracketSection` above the existing YTD row:

```
[☑] Use monthly salary instead of YTD
    Monthly gross (₪): [_________]
    → Auto-YTD: ₪52,800 (5 months × ₪10,560)
```

- Checkbox toggles which input is "live"
- When checked: monthly input enabled, YTD input disabled (greyed), YTD value visibly mirrors `monthly × currentMonth`
- When unchecked: monthly input disabled, YTD input enabled (today's behavior)
- "Auto-YTD" hint line only visible when checkbox is checked

Month count is `new Date().getMonth() + 1` (1–12). No "months worked" override — keeps the UI simple. Users with irregular income just toggle off and enter YTD directly.

## Content script changes (`content.js`)

In `recalculate()`, compute the effective YTD once:

```js
const monthsElapsed = new Date().getMonth() + 1;
const effectiveYtdILS = settings.useMonthlySalary
  ? (settings.monthlySalaryILS || 0) * monthsElapsed
  : (settings.ytdTaxableIncomeILS || 0);
```

Replace the existing inline expression that reads `settings.ytdTaxableIncomeILS` with `effectiveYtdILS`. Single touch point.

`STORAGE_DEFAULTS` and the initial `settings` object both gain `monthlySalaryILS: 0, useMonthlySalary: false`.

## Bracket-crossing warning

After the bracket loop in `recalculate()`, when `settings.incomeMode === 'bracket'` and any RSU ordinary income was taxed, compute:

```js
const startILS = effectiveYtdILS;
const endILS = priorGainILS; // accumulated by bracket loop above
const startBracket = bracketIndexFor(startILS);
const endBracket = bracketIndexFor(endILS);
```

`bracketIndexFor(amount)` is a new pure helper in `calculator.js` that returns the index into `IL_BRACKETS_2026` whose `limit` is the first one ≥ `amount`. Returned object also includes the bracket's rate and limit for display.

If `endBracket > startBracket`, show the warning banner with:

- Start bracket rate + range (e.g., "31% bracket (₪228k–₪301k)")
- End bracket rate + range (e.g., "35% bracket (₪301k–₪560k)")
- Amount that crosses into the highest reached bracket: `endILS − IL_BRACKETS_2026[endBracket - 1].limit`

If the warning crosses multiple brackets, the message shows start and *highest reached* end — not every intermediate bracket (keeps the banner short).

## Warning banner DOM (`injector.js`)

New export `injectBracketWarningBanner(table)`:

- Inserts a `<div class="il-tax-bracket-warning hidden">` directly above the table (sibling).
- Returns a handle: `{ banner, show(textObj), hide() }`.
- `show()` populates inner HTML with start/end rate, range, crossover amount. `hide()` toggles `.hidden`.

Styling: yellow background, dark border, warning icon ⚠. CSS added to `injector.css` (existing file used by injected elements).

`content.js` keeps the handle from `injectColumns()` (extend the returned object) and calls `show`/`hide` at the end of `recalculate()`:
- Bracket mode + crossing detected → `show(...)`
- Otherwise → `hide()`

## Tests

`tests/test-calculator.js`: add cases for `bracketIndexFor` — first bracket, last bracket, exact-limit boundary.

`tests/test-injection.js` (JSDOM harness): add a case that:
1. Loads page with one ≥2yr lot.
2. Sets bracket mode with `effectiveYtdILS = 220_000` (just below ₪228k boundary).
3. Sets qty so RSU ordinary income pushes total above ₪228k.
4. Asserts warning banner becomes visible and contains "31%" and "20%" labels.

Settings-flow test: confirm `monthlySalaryILS` round-trips popup → storage → content script and that `useMonthlySalary: true` makes YTD auto-compute.

## Out of scope

- No locale/i18n changes — text stays in English.
- No persistent dismissal of the warning ("don't show again" toggle).
- No retroactive change to existing tooltips/copy.

## Files touched

- `popup.html`, `popup.js`, `popup.css` — add checkbox, monthly input, auto-YTD hint, disable logic
- `content.js` — add `monthlySalaryILS`/`useMonthlySalary` to defaults, compute `effectiveYtdILS`, call warning banner
- `calculator.js` — add `bracketIndexFor` helper
- `injector.js`, `injector.css` (or `popup.css` if shared) — banner DOM + styling
- `tests/test-calculator.js`, `tests/test-injection.js` (or new `test-bracket-warning.js`) — coverage

## Release

Single PR (`Closes #<new-issue>`), merge to master, then version bump PR (1.2.1 → 1.2.2), push triggers Web Store publish via CI.
