# Chrome Web Store Listing Copy

Copy the text below directly into the Chrome Web Store Developer Dashboard
(Publish → Store listing → Description field).

---

## Short description (132 chars max — used in search results)

```
Israeli Section 102 income-track RSU tax calculator overlaid directly on the E*TRADE stock-plan holdings page.
```

---

## Full description

**See your Israeli tax bill before you sell — directly on E*TRADE.**

IL Tax Calculator overlays Israeli Section 102 income-track tax estimates on the E*TRADE RSU holdings page in real time. Enter a quantity, and instantly see your estimated IL Tax, Net Proceeds, and Effective Rate — per lot and in total — without leaving the page or copying numbers into a spreadsheet.

---

**How it works**

When you navigate to your E*TRADE stock plan holdings, the extension automatically adds four columns to the sellable holdings table:

- **IL Tax** — estimated Israeli tax for the quantity you enter
- **Net Proceeds** — gross proceeds minus IL tax
- **Rate** — effective tax rate for that lot
- **Tax vs Net** — a visual split bar showing the tax/net ratio

Click any IL Tax cell to open a full tax breakdown showing ordinary income and capital gains components, ILS equivalents, and a copy button.

---

**Section 102 income track rules — applied correctly**

Israeli Section 102 RSU taxation depends on the time elapsed from your **grant date** (not vest date):

- **≥ 2 years from grant** — ordinary income tax on FMV × qty; 25% capital gains tax on appreciation above FMV
- **< 2 years from grant** — ordinary income tax on the entire gross proceeds

The extension reads your grant dates directly from E*TRADE's embedded page data so the two-year clock is always accurate.

---

**Configuration**

Open the extension popup to choose:

- **Tax mode** — Flat rate (enter your marginal rate) or 2026 Israeli brackets (applied automatically)
- **Ordinary income rate** — your marginal rate for < 2yr lots (default 47%)
- **Capital gains rate** — for ≥ 2yr lots (default 25%); optional +3% surtax for high earners (§121b)
- **Resident tax credit** — annual credit subtracted in bracket mode (default ₪7,986)
- **Exchange rate** — auto-fetched from the Bank of Israel; editable for a manual override
- **Display currency** — USD or ILS; all amounts (table columns, breakdown popup, copy text) follow this setting

---

**Privacy**

All calculations run locally in your browser. No data leaves your device. Exchange rates are fetched from the Bank of Israel API (declared in the manifest). Settings are stored in Chrome sync storage.

---

**Disclaimer**

Estimates only. This extension is not financial or legal advice. Consult a qualified Israeli tax professional before making any tax-related decisions.

---

## Category

Finance

## Language

English

## Screenshots (suggested captions)

1. `il_tax_screenshot.png` — "IL Tax, Net Proceeds, Rate, and Tax vs Net columns injected directly into the E*TRADE RSU holdings table"
2. (breakdown popup screenshot) — "Click any IL Tax cell for a full breakdown: ordinary income vs capital gains, ILS amounts, grant date, and a copy button"
