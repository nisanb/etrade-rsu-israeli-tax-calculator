# Contributing

Thanks for your interest in improving this extension!

## Getting started

1. Fork the repo and clone locally
2. Load the extension unpacked in Chrome (`chrome://extensions` → Developer mode → Load unpacked)
3. Edit files — no build step required
4. Reload the extension after changes

## Running tests

```bash
node tests/calculator.test.js
node tests/parser.test.js
```

All tests must pass before submitting a PR.

## What to contribute

- Bug fixes for E*TRADE DOM changes (selectors, JSON paths)
- Updated tax brackets for a new tax year
- Additional fallback paths in `parser.js` for new E*TRADE data formats
- UI improvements to the popup or in-table tooltip

## What not to contribute

- Features that require a backend or external account
- Changes that break the zero-build-step constraint (no bundlers, no TypeScript)
- Modifications to tax law logic without citing the relevant ITA section

## Pull request checklist

- [ ] Tests pass (`node tests/*.test.js`)
- [ ] Extension loads without console errors on E*TRADE
- [ ] PR description explains what changed and why
- [ ] If updating tax rates/brackets, cite the source (ITA circular, Finance Ministry announcement, etc.)

## Reporting issues

Open a GitHub issue with:
- Chrome version
- E*TRADE page URL (path only, no account details)
- Console errors from the extension (`F12` → Console, filter by `[IL Tax]`)

## Disclaimer

This project is not affiliated with E*TRADE, Morgan Stanley, or the Israel Tax Authority.
All contributions are subject to the [MIT License](LICENSE).
