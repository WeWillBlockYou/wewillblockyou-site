/**
 * seller-feedback.js — Netlify Function
 * Fetches live seller feedback from BrickLink (scrape), BrickOwl (API),
 * and eBay (scrape) and returns combined stats for the WWBY landing page.
 *
 * Responses are cached for 1 hour (Cache-Control public, max-age=3600).
 *
 * Environment variables:
 *   BRICKOWL_API_KEY  — BrickOwl API key (set in Netlify env vars)
 *
 * Endpoint: GET /.netlify/functions/seller-feedback
 * Returns:
 *   {
 *     bricklink: { count: number, positive_pct: string, score: string },
 *     brickowl:  { count: number, positive_pct: string, score: string },
 *     ebay:      { count: number, positive_pct: string, score: string },
 *   }
 * Any platform that fails returns its last-known fallback value.
 */

// Fallback values (used if live fetch fails)
const FALLBACK = {
  bricklink: { count: 210, positive_pct: '98.63%', score: '98.63' },
  brickowl:  { count: 47,  positive_pct: '97.9%',  score: '97.9'  },
  ebay:      { count: 83,  positive_pct: '100%',   score: '100'   },
};

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/* ── BrickLink scrape ─────────────────────────────────────────────────────── */
async function fetchBrickLink() {
  const url = 'https://store.bricklink.com/wewillblockyou';
  const resp = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-AU,en;q=0.9' },
    signal: AbortSignal.timeout(7000),
  });
  if (!resp.ok) throw new Error('BrickLink HTTP ' + resp.status);
  const html = await resp.text();

  // BrickLink store page includes text like "Feedback: 210  (98.6%  Positive)"
  let count = null;
  let pct   = null;

  // Count — look for numeric value near the word "Feedback"
  const countMatch = html.match(/Feedback[^<]*?[\s:\(](\d{1,6})[\s\)]/i);
  if (countMatch) count = parseInt(countMatch[1], 10);

  // Percentage — look for 2-3 digit number with optional decimal followed by %
  const pctMatch = html.match(/(\d{2,3}(?:\.\d{1,2})?)\s*%\s*Positive/i);
  if (pctMatch) pct = pctMatch[1];

  // Fallback: try looking in JSON-LD or data attributes
  if (!count || !pct) {
    const ratingMatch = html.match(/"ratingValue"\s*:\s*"?([\d.]+)"?/);
    const ratingCount = html.match(/"ratingCount"\s*:\s*"?(\d+)"?/);
    if (ratingMatch && !pct) pct = (parseFloat(ratingMatch[1]) * 20).toFixed(1); // 0-5 → %
    if (ratingCount && !count) count = parseInt(ratingCount[1], 10);
  }

  if (!count && !pct) throw new Error('BrickLink parse failed');

  return {
    count:        count ?? FALLBACK.bricklink.count,
    positive_pct: pct ? pct + '%' : FALLBACK.bricklink.positive_pct,
    score:        pct ?? FALLBACK.bricklink.score,
  };
}

/* ── BrickOwl API ─────────────────────────────────────────────────────────── */
async function fetchBrickOwl(apiKey) {
  // BrickOwl public store info endpoint
  const url = `https://api.brickowl.com/v1/store/feedback?key=${encodeURIComponent(apiKey)}&username=wewillblockyou`;
  const resp = await fetch(url, {
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(7000),
  });
  if (!resp.ok) throw new Error('BrickOwl HTTP ' + resp.status);
  const json = await resp.json();

  // BrickOwl returns { feedback_count, feedback_score, feedback_percentage, ... }
  // or sometimes nested under data/store
  const d = json.data ?? json.store ?? json ?? {};
  const count = d.feedback_count ?? d.count ?? null;
  const score = d.feedback_score ?? d.feedback_percentage ?? null;

  if (count == null && score == null) throw new Error('BrickOwl no data');

  const pctNum = score != null ? Math.round(parseFloat(score) * 10) / 10 : null;

  return {
    count:        count ?? FALLBACK.brickowl.count,
    positive_pct: pctNum != null ? pctNum + '%' : FALLBACK.brickowl.positive_pct,
    score:        pctNum != null ? String(pctNum) : FALLBACK.brickowl.score,
  };
}

/* ── eBay scrape ──────────────────────────────────────────────────────────── */
async function fetchEbay() {
  const url = 'https://www.ebay.com.au/fdbk/feedback_profile/wewillblockyou';
  const resp = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-AU,en;q=0.9',
    },
    signal: AbortSignal.timeout(9000),
  });
  if (!resp.ok) throw new Error('eBay HTTP ' + resp.status);
  const html = await resp.text();

  let count = null;
  let pct   = null;

  // eBay feedback profile page usually contains "Positive Feedback (last 12 months)" and "XX.X%"
  // Also a total feedback score like "(83)" or "Feedback score: 83"
  const pctMatch = html.match(/(\d{2,3}(?:\.\d{1,2})?)\s*%\s*[Pp]ositive/);
  if (pctMatch) pct = pctMatch[1];

  // Total count — eBay shows "Feedback score: 83" or "83 feedback"
  const scoreMatch = html.match(/[Ff]eedback\s+[Ss]core[^<]*?[:\s](\d+)/);
  if (scoreMatch) count = parseInt(scoreMatch[1], 10);

  // Fallback patterns
  if (!pct) {
    const altPct = html.match(/Positive Feedback[^<]*?(\d{2,3}(?:\.\d{1,2})?)\s*%/i);
    if (altPct) pct = altPct[1];
  }
  if (!count) {
    const altCount = html.match(/(\d+)\s+[Ff]eedback/);
    if (altCount) count = parseInt(altCount[1], 10);
  }

  if (!count && !pct) throw new Error('eBay parse failed');

  return {
    count:        count ?? FALLBACK.ebay.count,
    positive_pct: pct ? pct + '%' : FALLBACK.ebay.positive_pct,
    score:        pct ?? FALLBACK.ebay.score,
  };
}

/* ── Handler ──────────────────────────────────────────────────────────────── */
export const handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=3600, stale-while-revalidate=7200',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  const boKey = process.env.BRICKOWL_API_KEY;

  const [blResult, boResult, ebResult] = await Promise.allSettled([
    fetchBrickLink(),
    boKey ? fetchBrickOwl(boKey) : Promise.reject(new Error('No BrickOwl key')),
    fetchEbay(),
  ]);

  const bricklink = blResult.status === 'fulfilled' ? blResult.value : FALLBACK.bricklink;
  const brickowl  = boResult.status === 'fulfilled' ? boResult.value : FALLBACK.brickowl;
  const ebay      = ebResult.status === 'fulfilled' ? ebResult.value : FALLBACK.ebay;

  // Log any scrape failures for debugging
  if (blResult.status === 'rejected') console.warn('BrickLink scrape failed:', blResult.reason?.message);
  if (boResult.status === 'rejected') console.warn('BrickOwl fetch failed:',  boResult.reason?.message);
  if (ebResult.status === 'rejected') console.warn('eBay scrape failed:',     ebResult.reason?.message);

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ bricklink, brickowl, ebay }),
  };
};
