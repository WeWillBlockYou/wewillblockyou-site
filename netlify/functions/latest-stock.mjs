import { timingSafeEqual } from 'node:crypto';

const ORIGIN = 'https://wwby.bricqer.com';
const INVENTORY_PATH = '/api/v1/inventory/items/'; // Existing site's endpoint; verify with schema mode.
const STORE = 'https://store.bricklink.com/wewillblockyou';
const MAX_PAGES = 250;
const MAX_ITEMS = 50000;

function equal(a, b) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function authorized(request, token) {
  const header = request.headers.get('authorization') || '';
  if (header.startsWith('Bearer ')) return equal(header.slice(7), token);
  if (header.startsWith('Basic ')) {
    const value = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const colon = value.indexOf(':');
    return colon >= 0 && value.slice(0, colon) === 'brevo' && equal(value.slice(colon + 1), token);
  }
  return false;
}

function json(body, status = 200) {
  return Response.json(body, { status, headers: {
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    ...(status === 401 ? { 'WWW-Authenticate': 'Basic realm="WWBY stock feed"' } : {}),
  } });
}

export function field(record, path) {
  return String(path || '').split('.').reduce((value, key) => {
    if (!key || ['__proto__', 'prototype', 'constructor'].includes(key)) return undefined;
    return value != null && Object.hasOwn(Object(value), key) ? value[key] : undefined;
  }, record);
}

function schema(value, depth = 0) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return { array: value.length ? schema(value[0], depth + 1) : 'empty' };
  if (typeof value !== 'object') return typeof value;
  if (depth >= 4) return 'object';
  return Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, entry]) => [key, schema(entry, depth + 1)]));
}

function text(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function validMapping(mapping) {
  const required = ['name', 'item_no', 'type', 'quantity', 'price', 'condition', 'listed_at', 'image_url'];
  return mapping?.currency === 'AUD'
    && required.every(key => typeof mapping.fields?.[key] === 'string' && mapping.fields[key])
    && Array.isArray(mapping.eligibility) && mapping.eligibility.length > 0
    && mapping.eligibility.every(rule => typeof rule.path === 'string' && Object.hasOwn(rule, 'equals'))
    && Array.isArray(mapping.types?.parts) && mapping.types.parts.length > 0
    && Array.isArray(mapping.types?.minifigures) && mapping.types.minifigures.length > 0
    && Object.values(mapping.conditions || {}).includes('New')
    && Object.values(mapping.conditions || {}).includes('Used');
}

export function buildFeed(records, mapping) {
  if (!validMapping(mapping)) throw new Error('mapping');
  const parts = [], figures = [];
  for (const record of records) {
    if (!mapping.eligibility.every(rule => field(record, rule.path) === rule.equals)) continue;
    const type = field(record, mapping.fields.type);
    const target = mapping.types.parts.includes(type) ? parts : mapping.types.minifigures.includes(type) ? figures : null;
    if (!target) continue;
    const quantityRaw = field(record, mapping.fields.quantity);
    if (quantityRaw == null || quantityRaw === '' || !Number.isInteger(Number(quantityRaw))) throw new Error('record');
    const quantity = Number(quantityRaw);
    if (quantity <= 0) continue;
    const priceRaw = field(record, mapping.fields.price);
    const price = Number(priceRaw);
    const name = field(record, mapping.fields.name);
    const itemNo = field(record, mapping.fields.item_no);
    const condition = mapping.conditions[String(field(record, mapping.fields.condition))];
    const listedRaw = field(record, mapping.fields.listed_at);
    const listed = typeof listedRaw === 'string' ? Date.parse(listedRaw) : NaN;
    const image = field(record, mapping.fields.image_url);
    if (typeof name !== 'string' || !name.trim() || !['string', 'number'].includes(typeof itemNo)
      || !String(itemNo).trim() || !['New', 'Used'].includes(condition)
      || priceRaw == null || priceRaw === '' || !Number.isFinite(price) || price < 0
      || !Number.isFinite(listed) || typeof image !== 'string' || new URL(image).protocol !== 'https:') throw new Error('record');
    let url = STORE;
    if (mapping.fields.url) {
      const destination = new URL(field(record, mapping.fields.url));
      if (destination.origin !== 'https://store.bricklink.com'
        || destination.pathname.toLowerCase() !== '/wewillblockyou') throw new Error('record');
      url = destination.href;
    }
    target.push({ name: text(name), item_no: text(itemNo), colour: text(field(record, mapping.fields.colour) || ''),
      condition, quantity, price_aud: price.toFixed(2), image_url: image, url, listed_at: new Date(listed).toISOString() });
  }
  const latest = items => items.sort((a, b) => b.listed_at.localeCompare(a.listed_at)
    || a.item_no.localeCompare(b.item_no)).slice(0, 4);
  return { generated_at: new Date().toISOString(), currency: 'AUD', latest_parts: latest(parts), latest_minifigures: latest(figures) };
}

async function page(url, key, fetcher) {
  const parsed = new URL(url);
  if (parsed.origin !== ORIGIN || parsed.pathname !== INVENTORY_PATH) throw new Error('pagination');
  const response = await fetcher(parsed.href, {
    headers: { Authorization: `Api-Key ${key}`, Accept: 'application/json' },
    redirect: 'error', signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error('upstream');
  const data = await response.json();
  const records = Array.isArray(data) ? data : data.results;
  if (!Array.isArray(records) || records.some(record => !record || typeof record !== 'object' || Array.isArray(record))) throw new Error('schema');
  return { data, records, next: Array.isArray(data) ? null : data.next,
    count: Array.isArray(data) ? null : data.count };
}

// Dependencies are injectable for offline tests. No customer/order endpoints are accessed.
export async function handle(request, env = process.env, fetcher = fetch) {
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  if (!env.STOCK_FEED_TOKEN) return json({ error: 'Stock feed token is not configured' }, 503);
  if (!authorized(request, env.STOCK_FEED_TOKEN)) return json({ error: 'Authentication required' }, 401);
  if (!env.BRICQER_API_KEY) return json({ error: 'Bricqer API key is not configured' }, 503);
  if (env.BRICQER_BASE_URL && env.BRICQER_BASE_URL.replace(/\/$/, '') !== ORIGIN) return json({ error: 'Unexpected Bricqer base URL' }, 503);
  const inspect = new URL(request.url).searchParams.get('mode') === 'schema';
  let mapping;
  if (!inspect) {
    try { mapping = JSON.parse(env.STOCK_FEED_MAPPING || 'null'); } catch { /* Report configuration, never the stored value. */ }
    if (!validMapping(mapping)) return json({ error: 'Inventory field mapping needs verification; use authenticated ?mode=schema first' }, 503);
  }
  try {
    let url = `${ORIGIN}${INVENTORY_PATH}?limit=200`;
    const records = [], visited = new Set();
    const deadline = Date.now() + 20000;
    let expectedCount = null;
    while (url) {
      if (visited.has(url) || visited.size >= MAX_PAGES || Date.now() > deadline) throw new Error('pagination');
      visited.add(url);
      const result = await page(url, env.BRICQER_API_KEY, fetcher);
      if (inspect) return json({ source: 'Bricqer inventory items', record_shape: schema(result.records[0] || {}),
        response_shape: schema(result.data), has_next_page: Boolean(result.next),
        note: 'Field names and value types only. No inventory values or API keys are returned. Mapping is not yet verified.' });
      records.push(...result.records);
      if (records.length > MAX_ITEMS) throw new Error('pagination');
      if (typeof result.count === 'number') expectedCount = result.count;
      url = result.next ? new URL(result.next, url).href : null;
    }
    if (expectedCount !== null && records.length !== expectedCount) throw new Error('pagination');
    return json(buildFeed(records, mapping));
  } catch {
    return json({ error: 'Inventory could not be verified. Check API access, field mapping and pagination; no sample stock was substituted.' }, 502);
  }
}

export default request => handle(request);
