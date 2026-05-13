# Privacy Policy

Last updated: May 13, 2026

`IL Tax Calculator for E*TRADE` is a Chrome extension that calculates Israeli tax estimates for RSU holdings shown on the E*TRADE stock-plan holdings page.

## What the extension accesses

The extension reads stock-plan holdings information from the E*TRADE stock-plan page that the user opens in Chrome. This data is used only to calculate and display Israeli tax estimates inside the user's browser.

The extension may access:

- Holdings and grant-related information shown on the E*TRADE stock-plan page
- User-entered calculator settings such as tax mode, rates, display currency, and exchange-rate preferences
- USD/ILS exchange-rate data returned by public exchange-rate APIs

## How the data is used

The extension uses E*TRADE page data only to:

- Parse holdings and grant information from the current page
- Calculate Israeli Section 102 tax estimates
- Render those estimates on the page and in the extension popup

The extension uses stored settings only to preserve the user's calculator preferences between sessions.

## Data storage

The extension stores configuration data in Chrome storage:

- `chrome.storage.sync` for user calculator settings
- `chrome.storage.local` for cached exchange-rate data and related preferences

The extension does not intentionally store full E*TRADE holdings data in persistent extension storage.

## External network requests

The extension fetches USD/ILS exchange-rate data from:

- Bank of Israel endpoints
- A fallback exchange-rate API if the primary source is unavailable

These requests are used only to retrieve exchange-rate information required for tax estimates.

## Data sharing

The extension does not:

- Transmit E*TRADE holdings data to the developer
- Sell user data
- Use user data for advertising
- Use user data for creditworthiness or lending decisions

## Security and scope

The extension is intended to run on the E*TRADE stock-plan holdings page and perform calculations locally in the browser.

## Contact

For questions about this privacy policy or the extension, use the repository support/contact channel associated with this project:

https://github.com/nisanb/etrade-rsu-israeli-tax-calculator
