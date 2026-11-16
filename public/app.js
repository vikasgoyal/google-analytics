'use strict';

const $ = id => document.getElementById(id);
const welcome = $('welcome');
const dashboard = $('dashboard');
const notice = $('notice');
const report = $('report');
const metricDefinitions = [
  ['Active users', 'People who engaged', 'activeUsers', 'integer'],
  ['New users', 'First-time visitors', 'newUsers', 'integer'],
  ['Sessions', 'Visits to your property', 'sessions', 'integer'],
  ['Views', 'Pages & screens viewed', 'screenPageViews', 'integer'],
  ['Engagement rate', 'Engaged sessions', 'engagementRate', 'percent'],
  ['Avg. session', 'Time spent per visit', 'averageSessionDuration', 'duration']
];

function showNotice(message) {
  notice.textContent = message;
  notice.hidden = !message;
}

async function getJSON(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'The request failed.');
  return data;
}

function formatNumber(value, type) {
  const number = Number(value || 0);
  if (type === 'percent') return `${(number * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
  if (type === 'duration') {
    const seconds = Math.round(number);
    return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
  }
  return number.toLocaleString();
}

function renderList(container, data, unit) {
  container.replaceChildren();
  const rows = data.rows || [];
  if (!rows.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'No data for this day.';
    container.append(empty);
    return;
  }
  const max = Math.max(...rows.map(row => Number(row.metricValues?.[0]?.value || 0)), 1);
  for (const row of rows) {
    const value = Number(row.metricValues?.[0]?.value || 0);
    const item = document.createElement('div');
    item.className = 'list-item';
    const line = document.createElement('div');
    line.className = 'list-line';
    const name = document.createElement('span');
    name.className = 'list-name';
    name.textContent = row.dimensionValues?.[0]?.value || '(not set)';
    name.title = name.textContent;
    const count = document.createElement('span');
    count.className = 'list-count';
    count.textContent = `${formatNumber(value)} ${value === 1 ? unit.replace(/s$/, '') : unit}`;
    const track = document.createElement('div');
    track.className = 'track';
    const fill = document.createElement('div');
    fill.className = 'fill';
    fill.style.width = `${value / max * 100}%`;
    track.append(fill);
    line.append(name, count);
    item.append(line, track);
    container.append(item);
  }
}

let searchSites;
let searchDate;
let searchGeneration = 0;

function pickSearchSite(sites, propertyName) {
  const host = propertyName.split(' · ')[0].toLowerCase();
  return sites.find(site => site.toLowerCase().includes(host)) || sites[0];
}

function renderMessage(id, text) {
  const message = document.createElement('p');
  message.className = 'empty';
  message.textContent = text;
  $(id).replaceChildren(message);
}

function renderTable(id, columns, rows) {
  const table = document.createElement('table');
  table.className = 'query-table';
  const head = table.createTHead().insertRow();
  for (const column of columns) {
    const cell = document.createElement('th');
    cell.scope = 'col';
    cell.textContent = column.label;
    if (column.text) cell.className = 'text-cell';
    head.append(cell);
  }
  const body = table.createTBody();
  for (const row of rows) {
    const tr = body.insertRow();
    for (const column of columns) {
      const cell = tr.insertCell();
      cell.textContent = column.value(row);
      if (column.text) cell.className = 'text-cell';
    }
  }
  $(id).replaceChildren(table);
}

const searchMetrics = [
  { label: 'CLICKS', value: row => formatNumber(row.clicks) },
  { label: 'IMPRESSIONS', value: row => formatNumber(row.impressions) },
  { label: 'CTR', value: row => formatNumber(row.ctr, 'percent') },
  { label: 'POSITION', value: row => Number(row.position).toFixed(1) }
];

function searchError(error) {
  return /scope|permission/i.test(error.message)
    ? 'Search Console access is missing. Sign out and connect again to grant it, and make sure the Search Console API is enabled.'
    : error.message;
}

async function loadSearchCard(id, endpoint, site, date, generation) {
  renderMessage(id, 'Loading…');
  try {
    const { rows, capped } = await getJSON(`/api/${endpoint}?${new URLSearchParams({ site, date })}`);
    if (generation !== searchGeneration) return;
    if (!rows.length) {
      return renderMessage(id, endpoint === 'search-queries'
        ? 'No search queries for this day. Data may not be available yet, and rare queries are hidden for privacy.'
        : `No qualifying opportunities for this day. Data may not be available yet or may not meet the thresholds.${capped ? ' Google returned the maximum 25,000 rows, so additional opportunities may be missing.' : ''}`);
    }
    const columns = [{ label: 'QUERY', text: true, value: row => row.keys?.[0] || '(not set)' }];
    if (endpoint === 'search-opportunities') {
      columns.push({ label: 'PAGE', text: true, value: row => row.keys?.[1] || '(not set)' });
    }
    renderTable(id, [...columns, ...searchMetrics], rows);
    if (capped) {
      const warning = document.createElement('p');
      warning.className = 'footnote';
      warning.textContent = 'Google returned the maximum 25,000 rows; additional opportunities may be missing.';
      $(id).append(warning);
    }
  } catch (error) {
    if (generation === searchGeneration) renderMessage(id, searchError(error));
  }
}

function loadSearchQueries() {
  const site = $('search-site').value;
  const generation = ++searchGeneration;
  if (!site) {
    for (const id of ['search-queries', 'search-opportunities']) renderMessage(id, 'No Search Console sites found for this account.');
    return;
  }
  loadSearchCard('search-queries', 'search-queries', site, searchDate, generation);
  loadSearchCard('search-opportunities', 'search-opportunities', site, searchDate, generation);
}

async function loadSearchSection(propertyName) {
  const select = $('search-site');
  const generation = ++searchGeneration;
  const previous = select.value;
  for (const id of ['search-queries', 'search-opportunities']) renderMessage(id, 'Loading…');
  try {
    if (!searchSites) searchSites = (await getJSON('/api/search-sites')).sites;
  } catch (error) {
    if (generation !== searchGeneration) return;
    select.replaceChildren();
    for (const id of ['search-queries', 'search-opportunities']) renderMessage(id, searchError(error));
    return;
  }
  if (generation !== searchGeneration) return;
  select.replaceChildren(...searchSites.map(site => new Option(site, site)));
  if (searchSites.length) select.value = searchSites.includes(previous) ? previous : pickSearchSite(searchSites, propertyName);
  loadSearchQueries();
}

$('search-site').addEventListener('change', loadSearchQueries);

function renderReport(data, date, propertyName) {
  const headers = data.overview.metricHeaders || [];
  const values = data.overview.rows?.[0]?.metricValues || [];
  const metrics = Object.fromEntries(headers.map((header, i) => [header.name, values[i]?.value]));
  $('metrics').replaceChildren();
  for (const [label, caption, key, type] of metricDefinitions) {
    const card = document.createElement('div');
    card.className = 'metric-card';
    const title = document.createElement('div');
    title.className = 'metric-label';
    title.textContent = label;
    const value = document.createElement('div');
    value.className = 'metric-value';
    value.textContent = formatNumber(metrics[key], type);
    const hint = document.createElement('div');
    hint.className = 'metric-caption';
    hint.textContent = caption;
    card.append(title, value, hint);
    $('metrics').append(card);
  }
  $('report-date').textContent = new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const timeZone = data.overview.metadata?.timeZone;
  $('report-subtitle').textContent = `${propertyName}${timeZone ? ` · ${timeZone}` : ''}`;
  renderList($('pages'), data.pages, 'views');
  renderList($('channels'), data.channels, 'sessions');
  renderList($('sources'), data.sources, 'sessions');
  renderList($('countries'), data.countries, 'sessions');
  renderList($('devices'), data.devices, 'sessions');
  renderList($('landing-pages'), data.landingPages, 'sessions');
  if (data.landingSources.rows?.length) {
    renderTable('landing-sources', [
      { label: 'LANDING PAGE', text: true, value: row => row.dimensionValues?.[0]?.value || '(not set)' },
      { label: 'SOURCE / MEDIUM', text: true, value: row => row.dimensionValues?.[1]?.value || '(not set)' },
      { label: 'SESSIONS', value: row => formatNumber(row.metricValues?.[0]?.value) }
    ], data.landingSources.rows);
  } else {
    renderMessage('landing-sources', 'No landing page sources for this day.');
  }
  report.hidden = false;
  searchDate = date;
  loadSearchSection(propertyName);
}

async function init() {
  const params = new URLSearchParams(location.search);
  const errors = {
    configuration: 'Add your Google OAuth credentials to .env before connecting.',
    state: 'The sign-in request expired or could not be verified. Please try again.',
    authorization: 'Google authorization was not completed. Please try again.',
    signin: 'Google sign-in failed. Check your credentials, redirect URI, and server console.'
  };
  if (params.has('error')) {
    showNotice(errors[params.get('error')] || 'Sign-in failed. Please try again.');
    history.replaceState(null, '', '/');
  }
  try {
    const session = await getJSON('/api/session');
    if (!session.signedIn) {
      welcome.hidden = false;
      if (!session.configured && !params.has('error')) showNotice('To get started, add your Google OAuth credentials to .env. See the README for setup.');
      return;
    }
    dashboard.hidden = false;
    $('logout').hidden = false;
    const { properties } = await getJSON('/api/properties');
    $('property').replaceChildren();
    if (!properties.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No GA4 properties found';
      $('property').append(option);
      $('submit').disabled = true;
      showNotice('No accessible GA4 properties were found. Check that this Google account has access to a property.');
      return;
    }
    for (const property of properties) {
      const option = document.createElement('option');
      option.value = property.id;
      option.textContent = `${property.name} · ${property.account}`;
      $('property').append(option);
    }
  } catch (error) {
    showNotice(error.message);
  }
}

$('filters').addEventListener('submit', async event => {
  event.preventDefault();
  searchGeneration++;
  showNotice('');
  report.hidden = true;
  $('loading').hidden = false;
  $('submit').disabled = true;
  const date = $('date').value;
  const select = $('property');
  const propertyName = select.selectedOptions[0].textContent;
  select.disabled = true;
  $('date').disabled = true;
  try {
    const params = new URLSearchParams({ date, property: select.value });
    const data = await getJSON(`/api/report?${params}`);
    renderReport(data, date, propertyName);
  } catch (error) {
    showNotice(error.message);
  } finally {
    $('loading').hidden = true;
    $('submit').disabled = false;
    select.disabled = false;
    $('date').disabled = false;
  }
});

$('logout').addEventListener('click', async () => {
  try {
    const response = await fetch('/auth/logout', { method: 'POST' });
    if (!response.ok) throw new Error('Could not sign out. Please try again.');
    location.assign('/');
  } catch (error) {
    showNotice(error.message);
  }
});

const yesterday = new Date();
yesterday.setDate(yesterday.getDate() - 1);
$('date').value = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
init();
