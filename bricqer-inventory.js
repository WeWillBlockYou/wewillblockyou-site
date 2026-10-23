/**
 * bricqer-inventory.js — Netlify Function
 * Fetches the 12 most recently added inventory items from Bricqer
 * and returns them as JSON for the WWBY landing page.
 *
 * Set BRICQER_API_KEY in Netlify site environment variables.
 */

const BRICQER_TENANT = 'wwby';
const ITEMS_LIMIT = 12;

export const handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=300', // 5-minute cache
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  const apiKey = process.env.BRICQER_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server misconfigured' }) };
  }

  const url = `https://${BRICQER_TENANT}.bricqer.com/api/v1/inventory/items/?limit=${ITEMS_LIMIT}&ordering=-created_at`;

  let response;
  try {
    response = await fetch(url, {
      headers: {
        'Authorization': `Api-Key ${apiKey}`,
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: 'Bricqer unreachable', detail: err.message }) };
  }

  if (!response.ok) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: 'Bricqer unavailable', status: response.status }) };
  }

  const data = await response.json();

  // Normalise to a simple array the frontend expects:
  // { name, color, qty, price, img, condition, part_no }
  const items = (data.results ?? data).map((item) => ({
    name:      item.item_name  ?? item.name        ?? 'Part',
    color:     item.color_name ?? item.color        ?? '',
    qty:       String(item.quantity ?? item.qty ?? 0) + 'x',
    price:     'AU $' + Number(item.price ?? 0).toFixed(2),
    condition: (item.condition ?? 'U') === 'N' ? 'New' : 'Used',
    img:       item.image_url  ?? item.img          ?? '',
    part_no:   item.item_no    ?? '',
  }));

  return { statusCode: 200, headers, body: JSON.stringify({ items }) };
};
