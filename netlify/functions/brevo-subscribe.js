/**
 * brevo-subscribe.js — Netlify Function
 * Receives { email } from the WWBY landing page,
 * adds the contact to Brevo list ID 4 "We Will Block You Clients".
 *
 * Set BREVO_API_KEY in Netlify site environment variables.
 */

const BREVO_LIST_ID = 4;

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

  let email;
  try {
    const body = JSON.parse(event.body || '{}');
    email = body.email;
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid email' }) };
  }

  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server misconfigured' }) };
  }

  const response = await fetch('https://api.brevo.com/v3/contacts', {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      email,
      listIds: [BREVO_LIST_ID],
      updateEnabled: true,
    }),
  });

  if (response.status === 201 || response.status === 204) {
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  }

  const detail = await response.text();
  return {
    statusCode: 500,
    headers,
    body: JSON.stringify({ error: 'Brevo error', detail }),
  };
};
