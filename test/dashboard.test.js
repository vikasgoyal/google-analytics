'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

class Element {
  constructor() {
    this.children = [];
    this.value = '';
    this.textContent = '';
    this.hidden = false;
    this.style = {};
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener() {}
  createTHead() { const head = new Element(); this.append(head); return head; }
  createTBody() { const body = new Element(); this.append(body); return body; }
  insertRow() { const row = new Element(); this.append(row); return row; }
  insertCell() { const cell = new Element(); this.append(cell); return cell; }
}

function dashboard() {
  const elements = new Map();
  const pending = [];
  const context = vm.createContext({
    document: {
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, new Element());
        return elements.get(id);
      },
      createElement: () => new Element()
    },
    location: { search: '' },
    history: { replaceState() {} },
    URLSearchParams,
    fetch(url) {
      if (url === '/api/session') return Promise.resolve({ ok: true, json: async () => ({ signedIn: false, configured: true }) });
      return new Promise(resolve => pending.push({ url, resolve: data => resolve({ ok: true, json: async () => data }) }));
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8'), context);
  return { context, elements, pending };
}

test('renders landing page totals and their source combinations separately', () => {
  const { context, elements } = dashboard();
  vm.runInContext(`
    renderReport({
      overview: {}, pages: {}, channels: {}, sources: {}, countries: {}, devices: {},
      landingPages: { rows: [{ dimensionValues: [{ value: '/start' }], metricValues: [{ value: '7' }] }] },
      landingSources: { rows: [{ dimensionValues: [{ value: '/start' }, { value: 'google / organic' }], metricValues: [{ value: '3' }] }] }
    }, '2024-02-29', 'Example');
  `, context);
  const landing = elements.get('landing-pages').children[0];
  assert.equal(landing.children[0].children[0].textContent, '/start');
  assert.equal(landing.children[0].children[1].textContent, '7 sessions');
  const bodyRow = elements.get('landing-sources').children[0].children[1].children[0];
  assert.deepEqual(bodyRow.children.map(cell => cell.textContent), ['/start', 'google / organic', '3']);
});

test('ignores stale search results when the site changes', async () => {
  const { context, elements, pending } = dashboard();
  vm.runInContext("searchDate = '2024-02-29'; $('search-site').value = 'https://old.example/'; loadSearchQueries(); $('search-site').value = 'https://new.example/'; loadSearchQueries();", context);
  assert.equal(pending.length, 4);
  const data = (query, page) => ({ rows: [{ keys: [query, page], clicks: 0, impressions: 10, ctr: 0, position: 4 }] });
  pending[2].resolve(data('new query', 'https://new.example/page'));
  pending[3].resolve(data('new opportunity', 'https://new.example/page'));
  await new Promise(resolve => setImmediate(resolve));
  pending[0].resolve(data('old query', 'https://old.example/page'));
  pending[1].resolve(data('old opportunity', 'https://old.example/page'));
  await new Promise(resolve => setImmediate(resolve));
  const queryRow = elements.get('search-queries').children[0].children[1].children[0];
  const opportunityRow = elements.get('search-opportunities').children[0].children[1].children[0];
  assert.equal(queryRow.children[0].textContent, 'new query');
  assert.equal(opportunityRow.children[0].textContent, 'new opportunity');
  assert.equal(opportunityRow.children[1].textContent, 'https://new.example/page');
});
