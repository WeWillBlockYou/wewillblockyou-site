/**
 * brevo-subscribe.js — Netlify Function
 * Receives { email } from the WWBY site (homepage signup and /join).
 * Starts Brevo's double opt-in: Brevo emails a confirmation link, and only
 * when the person clicks it are they added to list 5
 * "We Will Block You — Confirmed signups". They then land on /thanks/.
 *
 * Needs BREVO_API_KEY in Netlify site environment variables.
 * The DOI template must be active in Brevo, tagged "optin", and contain
 * a {{ doubleoptin }} link.
 */

const CONFIRMED_LIST_ID = 5;
const DOI_TEMPLATE_ID = 5;
const REDIRECT_URL = 'https://wewillblockyou.com/thanks/';

export const handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  // Honeypot: a hidden field people never see. Bots fill it in, so pretend it worked.
  if (body.website) {
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  }

  const email = String(body.email || '').trim();
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid email' }) };
  }

  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server misconfigured' }) };
  }

  const response = await fetch('https://api.brevo.com/v3/contacts/doubleOptinConfirmation', {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      email,
      includeListIds: [CONFIRMED_LIST_ID],
      templateId: DOI_TEMPLATE_ID,
      redirectionUrl: REDIRECT_URL,
    }),
  });

  if (response.status === 201 || response.status === 204) {
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  }

  const detail = await response.text();
  console.error('Brevo DOI error', response.status, detail);
  return { statusCode: 502, headers, body: JSON.stringify({ error: 'Brevo error' }) };
};
