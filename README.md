# 🇮🇱 IL Tax Calculator for E*TRADE RSU

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue.svg)](manifest.json)
[![Version](https://img.shields.io/badge/version-1.1.0-brightgreen.svg)](manifest.json)
[![Chrome Web Store](https://img.shields.io/badge/Chrome%20Web%20Store-Install-blue?logo=googlechrome)](https://chromewebstore.google.com/detail/il-tax-calculator-for-etr/nofodmdhjbijfieiapcpaoiadhekoknd)

A Chrome extension that overlays **Israeli Section 102 income-track tax estimates** directly onto the E*TRADE stock-plan holdings page. Enter a quantity to sell, and instantly see your estimated IL tax, net proceeds, and effective rate — per lot and in total.

> ⚠ **Estimates only.** This tool is not financial or legal advice. Consult a qualified Israeli tax professional before making decisions.

---

## Features

- **Live per-lot tax overlay** — IL Tax, Net Proceeds, Effective Rate, and a Tax vs Net split-bar injected into the E*TRADE sellable holdings table
- **Section 102 income track rules** — correct two-track calculation:
  - **≥ 2 years from grant date:** ordinary income tax on FMV × qty + 25% capital gains on appreciation
  - **< 2 years from grant date:** ordinary income tax on entire gross proceeds
- **Grant-date aware** — reads grant date from E*TRADE's embedded page JSON (`stockplanjson`) so the 2-year clock starts at the correct date
- **Two tax modes:**
  - *Flat rate* — enter your marginal ordinary income rate directly
  - *Bracket mode* — 2026 Israeli brackets applied automatically, with resident tax credit
- **Live exchange rate** — fetched from Bank of Israel (BOI API), cached locally, refreshable
- **Click-to-open tax breakdown popup** — Octavian-style modal with full calculation detail, ILS amounts, and a copy button
- **"Select All" button support** — qty poller catches React programmatic updates the DOM `input` event misses

---

## Screenshots

| Holdings table with IL Tax columns | Tax breakdown popup |
|---|---|
| *(reload extension on E*TRADE to see)* | *(click any IL Tax cell)* |

---

## Installation

**[→ Install from the Chrome Web Store](https://chromewebstore.google.com/detail/il-tax-calculator-for-etr/nofodmdhjbijfieiapcpaoiadhekoknd)**

No setup required — install, navigate to E*TRADE, and the IL Tax columns appear automatically.

---

## Installation (Developer / Unpacked)

1. Clone or download this repository
2. Open Chrome → `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** → select the repo folder
5. Navigate to `https://us.etrade.com/etx/sp/stockplan#/sell`
6. The IL Tax columns appear automatically in the RSU holdings table

---

## Configuration

Click the extension icon in the Chrome toolbar to open the popup:

| Setting | Default | Notes |
|---|---|---|
| Tax Mode | Has income (flat) | Switch to Brackets if you have no other IL income this year |
| Ordinary income rate | 47% | Your marginal rate for < 2yr lots |
| Capital gains rate | 25% | For ≥ 2yr lots (appreciation only) |
| +3% surtax on CG | Off | Enable if annual income > ₪721,561 |
| Resident tax credit | ₪7,986 | 2026 annual credit (bracket mode only) |
| USD / ILS | Auto (BOI) | Auto-fetched; editable for manual override |
| Display currency | USD | Toggle to ILS to see all amounts in sheqels |

---

## Tax Rules (Section 102 Income Track)

Israeli Section 102 RSU taxation depends on time elapsed **from grant date** (not vest date):

**≥ 2 years from grant:**
```
Ordinary income tax = rate × min(gross proceeds, FMV × qty)
Capital gains tax   = 25% × max(0, gross proceeds − FMV × qty)
Total tax           = ordinary income tax + capital gains tax
```

**< 2 years from grant:**
```
Total tax = ordinary income rate × entire gross proceeds
```

Bracket mode applies the 2026 Israeli marginal brackets to ordinary income portions,
then subtracts the annual resident tax credit.

---

## Project Structure

```
├── manifest.json        Chrome extension manifest (MV3)
├── calculator.js        Section 102 tax math (pure functions)
├── parser.js            Parses E*TRADE stockplanjson (lot data, grant dates)
├── injector.js          DOM injection, popup rendering, split-bar column
├── exchange-rate.js     Bank of Israel rate fetch + local cache
├── content.js           Orchestrator: ties everything together
├── popup.html/css/js    Extension popup UI
└── icons/               Extension icons (16, 48, 128 px)
```

---

## Development

No build step. Edit JS/CSS directly and reload the extension in `chrome://extensions`.

Run the test suite (Node.js):
```bash
node tests/test-calculator.js
node tests/test-parser.js
node tests/test-package-extension.js
```

Package the extension for upload:
```bash
python3 scripts/package_extension.py --source . --output dist/il-tax-calculator-etrade.zip
```

Chrome Web Store submission and CI/CD setup notes live in [docs/chrome-web-store.md](docs/chrome-web-store.md).

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## License

[MIT](LICENSE) © 2025 Nisan
