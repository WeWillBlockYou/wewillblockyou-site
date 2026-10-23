/**
 * bricqer-inventory.js — Netlify Function
 * Fetches the latest inventory items from Bricqer, split into
 * parts/bricks and minifigures, for the WWBY landing page.
 *
 * Set BRICQER_API_KEY in Netlify site environment variables.
 */

const BRICQER_TENANT = 'wwby';
const ITEMS_LIMIT = 24; // fetch more so we have enough of each type after splitting

export const handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=300',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  const apiKey = process.env.BRICQER_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server misconfigured' }) };
  }

  // Try the standard inventory endpoint
  const url = `https://${BRICQER_TENANT}.bricqer.com/api/v1/inventory/?limit=${ITEMS_LIMIT}&ordering=-created_at`;

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
    const text = await response.text().catch(() => '');
    return { statusCode: 502, headers, body: JSON.stringify({ error: 'Bricqer unavailable', status: response.status, detail: text.substring(0, 200) }) };
  }

  const data = await response.json();
  const raw = data.results ?? data ?? [];

  const allItems = raw.map((item) => {
    // Detect minifigures: BrickLink item_type 'M' or type containing 'minifig'
    const type = (item.item_type ?? item.type ?? '').toString().toLowerCase();
    const isMinifig = type === 'm' || type.includes('minifig');

    // Build BrickLink image URL if we have a part/fig number
    const itemNo = item.item_no ?? item.part_no ?? item.bl_item_no ?? '';
    const imageType = isMinifig ? 'MN' : 'PN';
    const colorId = item.color_id ?? item.bl_color_id ?? '0';
    const blImg = itemNo
      ? `https://img.bricklink.com/ItemImage/${imageType}/${colorId}/${itemNo}.png`
      : '';
    const img = item.image_url ?? item.img ?? blImg ?? '';

    return {
      name:      item.item_name  ?? item.name   ?? (isMinifig ? 'Minifigure' : 'Part'),
      color:     item.color_name ?? item.color   ?? '',
      qty:       (item.quantity  ?? item.qty     ?? 0),
      price:     'AU $' + Number(item.price ?? 0).toFixed(2),
      condition: (item.condition ?? 'U') === 'N' ? 'New' : 'Used',
      img,
      part_no:   itemNo,
      isMinifig,
    };
  });

  const parts   = allItems.filter(i => !i.isMinifig).slice(0, 12);
  const minifigs = allItems.filter(i =>  i.isMinifig).slice(0, 12);

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ parts, minifigs }),
  };
};
