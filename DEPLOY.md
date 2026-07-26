# Shikaar — GitHub + Vercel deployment

This package is already flattened correctly: `api/`, `lib/`, `public/`, and
`vercel.json` are at the repository root.

## 1. Upload to GitHub

1. Sign in to GitHub and create a new repository named `shikaar`.
2. Open the empty repository's **uploading an existing file** link.
3. Extract this ZIP and upload the **contents** of the extracted folder.
4. Confirm these are visible at the repository root:

   ```text
   api/  lib/  public/  test/
   package.json  server.js  vercel.json
   ```

5. Commit the files.

## 2. Import into Vercel

1. Sign in to Vercel with GitHub.
2. Choose **Add New > Project** and import the `shikaar` repository.
3. Keep **Framework Preset: Other**.
4. Leave Build Command blank. Vercel serves the `public/` directory and deploys
   `api/search.js` as a function.
5. Deploy.

## 3. Create Reddit OAuth credentials

Reddit currently requires OAuth for Data API traffic, especially from hosted
provider IP addresses. Use this only for an approved, non-commercial use case
unless Reddit gives you separate commercial permission.

1. Sign in to Reddit.
2. Complete Reddit's current Data API sign-up/approval process if prompted.
3. Open `https://www.reddit.com/prefs/apps`.
4. Create an app:
   - name: `shikaar`
   - type: **web app**
   - redirect URI: your production Vercel URL, for example
     `https://shikaar-example.vercel.app`
5. Copy the client ID shown under the app name and the client secret.

## 4. Add Vercel environment variables

In **Vercel > Project > Settings > Environment Variables**, add:

| Variable | Value |
|---|---|
| `REDDIT_CLIENT_ID` | Reddit client ID |
| `REDDIT_CLIENT_SECRET` | Reddit client secret |
| `SHIKAAR_USER_AGENT` | `web:shikaar:1.0.0 (by /u/YOUR_USERNAME)` |

Apply them to Production and Preview, save, then redeploy the latest deployment.
Never put the client secret in frontend code or commit it to GitHub.

## 5. Verify

1. Open the deployed URL.
2. Confirm the status badge says `live · oauth`.
3. Search a product name and select one or more communities.
4. If requests fail, inspect **Vercel > Project > Logs**.

## Local verification

Requires Node.js 18 or later:

```bash
npm test
node server.js
```

Then open `http://localhost:3000`.

## Common errors

- `demo · no backend`: `api/search.js` is not at the repository root.
- `live · public`: OAuth variables are absent, misspelled, or the deployment was
  not redeployed after saving them.
- `401` / token failure: client ID or secret is wrong, or Data API access is not
  approved for the Reddit account/app.
- `403` / `429`: Reddit has blocked or rate-limited the request. Do not bypass
  the restriction; verify approval, credentials, User-Agent, and request volume.
- Site loads as 404: keep Framework Preset as Other and ensure `public/index.html`
  exists in the deployed source.
