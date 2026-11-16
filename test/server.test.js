'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { OAuth2Client } = require('google-auth-library');
const { app, validDate, selectOpportunities } = require('../server');

process.env.GOOGLE_CLIENT_ID = 'test-client';
process.env.GOOGLE_CLIENT_SECRET = 'test-secret';

const originalGetToken = OAuth2Client.prototype.getToken;
const originalRequest = OAuth2Client.prototype.request;
const calls = [];
OAuth2Client.prototype.getToken = async () => ({ tokens: { access_token: 'test-token' } });
OAuth2Client.prototype.request = async options => {
  calls.push(options);
  if (options.url.endsWith('/webmasters/v3/sites')) {
    return { data: { siteEntry: [{ siteUrl: 'https://example.com/', permissionLevel: 'siteOwner' }, { siteUrl: 'https://other.com/', permissionLevel: 'siteUnverifiedUser' }] } };
  }
  if (options.url.includes('searchAnalytics')) {
    if (options.data.dimensions.includes('page')) {
      return { data: { rows: [
        { keys: ['fewer', 'https://example.com/fewer'], clicks: 0, impressions: 6, ctr: 0, position: 5 },
        { keys: ['popular', 'https://example.com/popular'], clicks: 1, impressions: 20, ctr: 0.05, position: 4 },
        { keys: ['too few', 'https://example.com/small'], clicks: 0, impressions: 4, ctr: 0, position: 8 },
        { keys: ['high ctr', 'https://example.com/high'], clicks: 3, impressions: 10, ctr: 0.3, position: 2 }
      ] } };
    }
    return { data: { rows: [{ keys: ['hello'], clicks: 1, impressions: 5, ctr: 0.2, position: 3 }] } };
  }
  if (options.url.includes('accountSummaries')) {
    const nextPage = new URL(options.url).searchParams.has('pageToken');
    return { data: nextPage
      ? { accountSummaries: [{ displayName: 'Second', propertySummaries: [{ property: 'properties/456', displayName: 'Property B' }] }] }
      : { accountSummaries: [{ displayName: 'First', propertySummaries: [{ property: 'properties/123', displayName: 'Property A' }] }], nextPageToken: 'next' } };
  }
  return { data: { metricHeaders: options.data.metrics, rows: [] } };
};
const server = app.listen(0, '127.0.0.1');
after(() => {
  OAuth2Client.prototype.getToken = originalGetToken;
  OAuth2Client.prototype.request = originalRequest;
  server.close();
});

async function request(path, options = {}) {
  const address = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: address.port,
      path,
      method: options.method || 'GET',
      headers: { host: 'localhost:3000', ...options.headers }
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: { get: name => {
          const value = response.headers[name.toLowerCase()];
          return Array.isArray(value) ? value[0] : value ?? null;
        } },
        json: async () => JSON.parse(Buffer.concat(chunks).toString())
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('validates actual calendar dates', () => {
  assert.equal(validDate('2024-02-29'), true);
  assert.equal(validDate('2025-02-29'), false);
  assert.equal(validDate('2024-13-01'), false);
  assert.equal(validDate('2024-1-01'), false);
});

test('limits and ranks opportunities by impressions, breaking ties by CTR', () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ keys: [String(i), '/page'], impressions: i + 5, ctr: 0.1 }));
  rows.push({ keys: ['tie', '/page'], impressions: 16, ctr: 0 });
  rows.push({ keys: ['too few', '/page'], impressions: 4, ctr: 0 });
  rows.push({ keys: ['high ctr', '/page'], impressions: 100, ctr: 0.11 });
  const results = selectOpportunities(rows);
  assert.equal(results.length, 10);
  assert.deepEqual(results.slice(0, 2).map(row => row.keys[0]), ['tie', '11']);
  assert.equal(results.some(row => row.keys[0] === 'high ctr'), false);
  assert.deepEqual(selectOpportunities([{ impressions: 5, ctr: 0.1 }]).length, 1);
});

test('sign-in, paginated property listing, dated reports and logout', async () => {
  assert.equal((await request('/api/properties')).status, 401);
  assert.equal((await request('/api/search-opportunities?site=https%3A%2F%2Fexample.com%2F&date=2024-02-29')).status, 401);
  const start = await request('/auth/google');
  assert.equal(start.status, 302);
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  let cookie = start.headers.get('set-cookie').split(';')[0];
  const callback = await request(`/auth/callback?state=${state}&code=example`, { headers: { cookie } });
  assert.equal(callback.status, 302);
  cookie = callback.headers.get('set-cookie').split(';')[0];

  const properties = await (await request('/api/properties', { headers: { cookie } })).json();
  assert.deepEqual(properties.properties.map(p => p.id), ['123', '456']);
  const invalid = await request('/api/report?property=123&date=2025-02-29', { headers: { cookie } });
  assert.equal(invalid.status, 400);
  const result = await request('/api/report?property=123&date=2024-02-29', { headers: { cookie } });
  assert.equal(result.status, 200);
  assert.deepEqual(Object.keys(await result.json()), ['overview', 'pages', 'channels', 'sources', 'countries', 'devices', 'landingPages', 'landingSources']);
  const reports = calls.filter(call => call.url.includes(':runReport'));
  assert.equal(reports.length, 8);
  const landing = reports.find(call => call.data.dimensions?.length === 1 && call.data.dimensions[0].name === 'landingPagePlusQueryString');
  const landingSources = reports.find(call => call.data.dimensions?.length === 2);
  assert.deepEqual(landing.data.metrics, [{ name: 'sessions' }]);
  assert.deepEqual(landingSources.data.dimensions, [{ name: 'landingPagePlusQueryString' }, { name: 'sessionSourceMedium' }]);
  assert.equal(landingSources.data.limit, 20);
  const sites = await (await request('/api/search-sites', { headers: { cookie } })).json();
  assert.deepEqual(sites.sites, ['https://example.com/']);
  assert.equal((await request('/api/search-queries?site=javascript:x&date=2024-02-29', { headers: { cookie } })).status, 400);
  const queries = await (await request(`/api/search-queries?site=${encodeURIComponent('https://example.com/')}&date=2024-02-29`, { headers: { cookie } })).json();
  assert.equal(queries.rows[0].keys[0], 'hello');
  const searchCall = calls.find(call => call.url.includes('searchAnalytics'));
  assert.equal(searchCall.url, 'https://www.googleapis.com/webmasters/v3/sites/https%3A%2F%2Fexample.com%2F/searchAnalytics/query');
  assert.equal(searchCall.data.startDate, '2024-02-29');
  assert.equal((await request('/api/search-opportunities?site=javascript:x&date=2024-02-29', { headers: { cookie } })).status, 400);
  const opportunityResponse = await request(`/api/search-opportunities?site=${encodeURIComponent('https://example.com/')}&date=2024-02-29`, { headers: { cookie } });
  const opportunities = await opportunityResponse.json();
  assert.deepEqual(opportunities.rows.map(row => row.keys[0]), ['popular', 'fewer']);
  assert.equal(opportunities.capped, false);
  const opportunityCall = calls.find(call => call.data?.dimensions?.includes('page'));
  assert.deepEqual(opportunityCall.data, { startDate: '2024-02-29', endDate: '2024-02-29', dimensions: ['query', 'page'], rowLimit: 25000 });
  for (const call of reports) assert.deepEqual(call.data.dateRanges, [{ startDate: '2024-02-29', endDate: '2024-02-29' }]);
  assert.equal((await request('/auth/logout', { method: 'POST', headers: { cookie, origin: 'http://localhost:3000' } })).status, 204);
  assert.equal((await request('/api/properties', { headers: { cookie } })).status, 401);
});

test('rejects invalid OAuth state and external host', async () => {
  const start = await request('/auth/google');
  const cookie = start.headers.get('set-cookie').split(';')[0];
  const callback = await request('/auth/callback?state=wrong&code=example', { headers: { cookie } });
  assert.match(callback.headers.get('location'), /error=state/);
  const response = await request('/api/session', { headers: { host: 'attacker.example' } });
  assert.equal(response.status, 403);
});
