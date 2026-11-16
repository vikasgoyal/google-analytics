# Analytics Daybook

A local dashboard for exploring one day of Google Analytics 4 (GA4) and Google Search Console data. Choose a property and date to see where visitors came from, which pages they landed on, and which Google searches showed your site.

## What you can see

- **Traffic:** active and new users, sessions, views, engagement rate, and average session duration.
- **Audience and acquisition:** traffic channels, source / medium, countries, and devices.
- **Content:** top pages and screens, landing pages, and the sources of landing-page sessions.
- **Search:** queries with clicks, impressions, click-through rate (CTR), and average position. Search opportunities highlight query-and-page pairs with at least 5 impressions and at most 10% CTR.

Reports are for one day at a time. Search opportunities are leads to investigate, not guaranteed improvements; single-day results can be noisy.

## Requirements

- [Node.js](https://nodejs.org/) 20 or newer and npm.
- A Google account with access to a GA4 property.
- For search reports, access to a verified [Search Console property](https://search.google.com/search-console).
- A Google Cloud project where you can enable APIs and create OAuth credentials.

## Setup

### 1. Configure Google Cloud

1. Select or create a project in [Google Cloud Console](https://console.cloud.google.com/).
2. Under **APIs & Services > Library**, enable **Google Analytics Data API**, **Google Analytics Admin API**, and **Google Search Console API**.
3. Set up the OAuth consent screen in **Google Auth Platform**. Under **Data Access**, add these read-only scopes:
   - `https://www.googleapis.com/auth/analytics.readonly`
   - `https://www.googleapis.com/auth/webmasters.readonly`
4. If the audience is **External** and the app is in testing mode, add your Google account under **Audience > Test users**.
5. Under **Clients**, create an OAuth client of type **Web application**. Add this exact authorized redirect URI:

   ```text
   http://localhost:3000/auth/callback
   ```

6. Save the client ID and client secret for the next step. Google may display an unverified-app warning for a testing app.

### 2. Configure and run the app

Download or clone this repository and open a terminal in its folder. Copy `.env.example` to `.env`:

```powershell
# Windows PowerShell
Copy-Item .env.example .env
```

```sh
# macOS or Linux
cp .env.example .env
```

Edit `.env` and replace the placeholders with your OAuth client ID and secret:

```text
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
```

Keep `.env` private; never commit or share your credentials. Then install dependencies and start the app:

```sh
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000), connect your Google account, select a GA4 property and date, and choose **View report**. For search cards, select the appropriate Search Console site. Stop the app with `Ctrl+C`.

## Understanding the data

- GA4 uses the property's time zone; Search Console uses Pacific time. The same date may therefore cover different hours.
- Recent data may still be processing. Search Console data can lag by several days; try an older date if search results are empty.
- Search opportunities show up to 10 qualifying query/page pairs, ranked by impressions. Search Console can omit anonymized or other rows and returns results by clicks, so this is not an exhaustive list.
- Landing-page sources show the top 20 landing page/source-medium combinations. GA4 API results can differ from the Analytics UI because of processing, reporting identity, privacy thresholds, or sampling.

## Privacy and local use

The app requests read-only access and runs on your computer, listening only on loopback. Google tokens are held in server memory and are cleared when you sign out or restart the app. Signing out locally does not revoke Google's permission; manage access in your [Google Account connections](https://myaccount.google.com/connections).

This app is designed for local use, not deployment to a public server.

## Troubleshooting

- **Redirect URI mismatch:** confirm the OAuth client uses `http://localhost:3000/auth/callback` exactly, and open the app using `localhost`, not `127.0.0.1`.
- **Access blocked:** check the OAuth consent screen, requested scopes, and test-user list. Sign out and reconnect after changing permissions.
- **No GA4 properties:** sign in with an account that has access to a GA4 property and verify both Analytics APIs are enabled.
- **No Search Console sites or queries:** check access to the Search Console property, enable its API, grant the Search Console scope, and try an older date.
- **API disabled or quota exceeded:** follow the Google error message and check API enablement and quotas in the Cloud project containing your OAuth client.
- **Port 3000 already in use:** stop the application using that port, then start Analytics Daybook again.

## Development

Run the automated tests with `npm test`.
