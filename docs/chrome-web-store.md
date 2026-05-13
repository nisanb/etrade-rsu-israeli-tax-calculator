# Chrome Web Store Submission And CI/CD

## First submission

1. Register a Chrome Web Store developer account and pay the one-time fee.
2. Enable 2-step verification on the Google account that owns the publisher.
3. Zip the extension:
   `python3 scripts/package_extension.py --source . --output dist/il-tax-calculator-etrade.zip`
4. Open the Chrome Developer Dashboard and click `Add new item`.
5. Upload the zip file from `dist/`.
6. Complete the required dashboard tabs:
   - `Store listing`
   - `Privacy`
   - `Distribution`
   - `Test instructions` if review needs credentials or a test flow
7. Submit for review. You can defer publishing after approval if you do not want the first release to go live immediately.

## Required listing assets

- Extension icon in the package: `128x128`
- At least one screenshot: `1280x800` preferred, `640x400` allowed
- Small promo tile: `440x280`

## Recommended privacy answers for this extension

These still need a manual review in the dashboard because the final answers must match real behavior and your policy text.

- Single purpose: calculate Israeli tax estimates on the E*TRADE stock-plan holdings page
- User data:
  - Reads holdings data from the E*TRADE page the user is viewing
  - Stores extension settings in Chrome storage
  - Fetches exchange rates from BOI / ER API endpoints declared in the manifest
- No remote code
- No sale of user data

## One-time setup for automated updates

The GitHub Action in `.github/workflows/chrome-web-store.yml` will package every push to `master`, run tests, upload the zip as an artifact, and publish automatically once these secrets exist:

- `CHROME_EXTENSION_ID`
- `CHROME_WEBSTORE_PUBLISHER_ID`
- `CHROME_WEBSTORE_SERVICE_ACCOUNT_JSON`

Setup steps:

1. Create or choose a Google Cloud project.
2. Enable the `Chrome Web Store API`.
3. Create a Google Cloud service account.
4. In the Chrome Web Store Developer Dashboard, add that service account under `Account`.
5. Create a JSON key for the service account.
6. In GitHub repository settings, add the JSON key as the `CHROME_WEBSTORE_SERVICE_ACCOUNT_JSON` secret.
7. Add the extension ID from the Chrome Web Store item page as `CHROME_EXTENSION_ID`.
8. Add the publisher ID from the Developer Dashboard settings as `CHROME_WEBSTORE_PUBLISHER_ID`.

## Release behavior

- First publish: do it manually in the dashboard.
- Later updates: bump `manifest.json` version, push to `master`, and the workflow publishes the new package.
- If the secrets are missing, the workflow still packages the extension and stores the zip as a GitHub Actions artifact.
