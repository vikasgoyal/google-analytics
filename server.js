'use strict';

require('dotenv').config();
const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const session = require('express-session');
const { OAuth2Client } = require('google-auth-library');

const PORT = 3000;
const ORIGIN = `http://localhost:${PORT}`;
const REDIRECT_URI = `${ORIGIN}/auth/callback`;
const SCOPES = [
  'https://www.googleapis.com/auth/analytics.readonly',
  'https://www.googleapis.com/auth/webmasters.readonly'
];
const app = express();

app.disable('x-powered-by');
app.use((req, res, next) => {
  if (req.headers.host !== `localhost:${PORT}`) {
    return res.status(403).send('Open this app using http://localhost:3000.');
  }
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    'Cache-Control': 'no-store'
  });
  next();
});
app.use(session({
  secret: crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 8 * 60 * 60 * 1000 }
}));

function configured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function oauthClient() {
  return new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, REDIRECT_URI);
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function authFor(req) {
  const client = oauthClient();
  client.setCredentials(req.session.tokens);
  client.on('tokens', tokens => {
    req.session.tokens = { ...req.session.tokens, ...tokens };
  });
  return client;
}

async function googleRequest(client, options) {
  const response = await client.request(options);
  return response.data;
}

app.get('/api/session', (req, res) => {
  res.json({ configured: configured(), signedIn: Boolean(req.session.tokens) });
});

app.get('/auth/google', async (req, res, next) => {
  if (!configured()) return res.redirect('/?error=configuration');
  try {
    const client = oauthClient();
    const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
    const state = crypto.randomBytes(32).toString('hex');
    req.session.oauth = { state, codeVerifier };
    req.session.save(err => {
      if (err) return next(err);
      res.redirect(client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: SCOPES,
        state,
        code_challenge_method: 'S256',
        code_challenge: codeChallenge
      }));
    });
  } catch (error) {
    next(error);
  }
});

app.get('/auth/callback', async (req, res, next) => {
  const pending = req.session.oauth;
  delete req.session.oauth;
  if (!pending || typeof req.query.state !== 'string' || req.query.state !== pending.state) {
    return res.redirect('/?error=state');
  }
  if (req.query.error || typeof req.query.code !== 'string') return res.redirect('/?error=authorization');
  try {
    const { tokens } = await oauthClient().getToken({ code: req.query.code, codeVerifier: pending.codeVerifier });
    req.session.regenerate(err => {
      if (err) return next(err);
      req.session.tokens = tokens;
      req.session.save(saveError => {
        if (saveError) return next(saveError);
        res.redirect('/');
      });
    });
  } catch (error) {
    console.error('Google sign-in failed:', error.message);
    res.redirect('/?error=signin');
  }
});

app.post('/auth/logout', (req, res, next) => {
  if (req.get('origin') !== ORIGIN) return res.status(403).json({ error: 'Invalid request origin.' });
  req.session.destroy(err => {
    if (err) return next(err);
    res.clearCookie('connect.sid');
    res.sendStatus(204);
  });
});

app.use('/api', (req, res, next) => {
  if (!req.session.tokens) return res.status(401).json({ error: 'Please connect your Google account again.' });
  next();
});

app.get('/api/properties', async (req, res, next) => {
  try {
    const client = authFor(req);
    const properties = [];
    let pageToken;
    do {
      const params = new URLSearchParams({ pageSize: '200' });
      if (pageToken) params.set('pageToken', pageToken);
      const data = await googleRequest(client, { url: `https://analyticsadmin.googleapis.com/v1beta/accountSummaries?${params}` });
      for (const account of data.accountSummaries || []) {
        for (const property of account.propertySummaries || []) {
          if (/^properties\/\d+$/.test(property.property)) {
            properties.push({ id: property.property.slice(11), name: property.displayName, account: account.displayName });
          }
        }
      }
      pageToken = data.nextPageToken;
    } while (pageToken);
    res.json({ properties });
  } catch (error) {
    next(error);
  }
});

app.get('/api/report', async (req, res, next) => {
  const { property, date } = req.query;
  if (typeof property !== 'string' || !/^\d+$/.test(property) || !validDate(date)) {
    return res.status(400).json({ error: 'Choose a valid property and date.' });
  }
  const client = authFor(req);
  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${property}:runReport`;
  const dateRanges = [{ startDate: date, endDate: date }];
  const report = (metrics, dimensions = [], limit) => googleRequest(client, {
    url,
    method: 'POST',
    data: {
      dateRanges,
      metrics: metrics.map(name => ({ name })),
      ...(dimensions.length ? { dimensions: dimensions.map(name => ({ name })) } : {}),
      ...(limit ? { limit, orderBys: [{ metric: { metricName: metrics[0] }, desc: true }] } : {})
    }
  });
  try {
    const [overview, pages, channels, sources, countries, devices, landingPages, landingSources] = await Promise.all([
      report(['activeUsers', 'newUsers', 'sessions', 'screenPageViews', 'engagementRate', 'averageSessionDuration']),
      report(['screenPageViews'], ['unifiedPagePathScreen'], 10),
      report(['sessions'], ['sessionDefaultChannelGroup'], 10),
      report(['sessions'], ['sessionSourceMedium'], 10),
      report(['sessions'], ['country'], 10),
      report(['sessions'], ['deviceCategory'], 10),
      report(['sessions'], ['landingPagePlusQueryString'], 10),
      report(['sessions'], ['landingPagePlusQueryString', 'sessionSourceMedium'], 20)
    ]);
    res.json({ overview, pages, channels, sources, countries, devices, landingPages, landingSources });
  } catch (error) {
    next(error);
  }
});

app.get('/api/search-sites', async (req, res, next) => {
  try {
    const data = await googleRequest(authFor(req), { url: 'https://www.googleapis.com/webmasters/v3/sites' });
    const sites = (data.siteEntry || [])
      .filter(site => site.permissionLevel !== 'siteUnverifiedUser')
      .map(site => site.siteUrl);
    res.json({ sites });
  } catch (error) {
    next(error);
  }
});

app.get('/api/search-queries', async (req, res, next) => {
  const { site, date } = req.query;
  if (typeof site !== 'string' || site.length > 300 || !/^(https?:\/\/|sc-domain:)/.test(site) || !validDate(date)) {
    return res.status(400).json({ error: 'Choose a valid site and date.' });
  }
  try {
    const data = await googleRequest(authFor(req), {
      url: `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`,
      method: 'POST',
      data: { startDate: date, endDate: date, dimensions: ['query'], rowLimit: 10 }
    });
    res.json({ rows: data.rows || [] });
  } catch (error) {
    next(error);
  }
});

app.get('/api/search-opportunities', async (req, res, next) => {
  const { site, date } = req.query;
  if (typeof site !== 'string' || site.length > 300 || !/^(https?:\/\/|sc-domain:)/.test(site) || !validDate(date)) {
    return res.status(400).json({ error: 'Choose a valid site and date.' });
  }
  try {
    const data = await googleRequest(authFor(req), {
      url: `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`,
      method: 'POST',
      data: { startDate: date, endDate: date, dimensions: ['query', 'page'], rowLimit: 25000 }
    });
    const rows = data.rows || [];
    res.json({
      rows: selectOpportunities(rows),
      capped: rows.length === 25000
    });
  } catch (error) {
    next(error);
  }
});

function selectOpportunities(rows) {
  return rows.filter(row => row.impressions >= 5 && row.ctr <= 0.1)
    .sort((a, b) => b.impressions - a.impressions || a.ctr - b.ctr)
    .slice(0, 10);
}

app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html' }));
app.use((error, req, res, next) => {
  console.error('Request failed:', error.message);
  const status = error.response?.status;
  if (status === 401) return res.status(401).json({ error: 'Your Google session expired. Sign out and connect again.' });
  const message = error.response?.data?.error?.message;
  res.status(status >= 400 && status < 500 ? status : 500).json({
    error: typeof message === 'string' ? message : 'Something went wrong. Check the server console and try again.'
  });
});

if (require.main === module) {
  app.listen(PORT, '127.0.0.1', () => console.log(`Analytics Daybook is running at ${ORIGIN}`));
}

module.exports = { app, validDate, selectOpportunities };
