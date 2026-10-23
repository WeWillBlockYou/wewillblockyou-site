/**
 * contact.js — Netlify Function
 * Accepts a contact form POST and sends the message to mitchellsmart@gmail.com
 * via Brevo (Sendinblue) transactional email API.
 *
 * Environment variables required (set in Netlify site settings):
 *   BREVO_API_KEY — Brevo API key
 */

const BREVO_API = 'https://api.brevo.com/v3/smtp/email';
const TO_EMAIL  = 'mitchellsmart@gmail.com';
const TO_NAME   = 'Mitchell Smart';
const FROM_EMAIL = 'noreply@wewillblockyou.com';
const FROM_NAME  = 'We Will Block You';

const SUBJECT_LABELS = {
  order:    'Question about an order',
  parts:    'Looking for specific parts',
  minifigs: 'Minifigure enquiry',
  bulk:     'Bulk / wholesale enquiry',
  other:    'General enquiry',
};

export const handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.error('BREVO_API_KEY not set');
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server misconfigured' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { name, email, subject, message } = body;

  if (!name || !email || !message) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields' }) };
  }

  // Basic email validation
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid email address' }) };
  }

  const subjectLabel = SUBJECT_LABELS[subject] ?? 'Website enquiry';

  const emailHtml = `
<div style="font-family: 'DM Sans', Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #3b312e;">
  <div style="background: #f4c524; padding: 24px 32px; border-radius: 8px 8px 0 0;">
    <h2 style="margin: 0; font-size: 22px; color: #3b312e;">New Message — We Will Block You</h2>
    <p style="margin: 4px 0 0; font-size: 13px; opacity: 0.7;">${subjectLabel}</p>
  </div>
  <div style="background: #ffffff; padding: 28px 32px; border: 1px solid #e8e4dc; border-top: none; border-radius: 0 0 8px 8px;">
    <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 20px;">
      <tr><td style="padding: 6px 0; color: #6b5e58; width: 80px;">From</td><td style="padding: 6px 0; font-weight: 600;">${escHtml(name)}</td></tr>
      <tr><td style="padding: 6px 0; color: #6b5e58;">Email</td><td style="padding: 6px 0;"><a href="mailto:${escHtml(email)}" style="color: #1f39e3;">${escHtml(email)}</a></td></tr>
      <tr><td style="padding: 6px 0; color: #6b5e58;">Subject</td><td style="padding: 6px 0;">${subjectLabel}</td></tr>
    </table>
    <hr style="border: none; border-top: 1px solid #e8e4dc; margin: 0 0 20px;">
    <div style="font-size: 15px; line-height: 1.6; white-space: pre-wrap;">${escHtml(message)}</div>
  </div>
  <p style="font-size: 11px; color: #6b5e58; text-align: center; margin-top: 16px;">
    Sent from wewillblockyou.com contact form
  </p>
</div>`.trim();

  const emailText = `New message from ${name} <${email}>\nSubject: ${subjectLabel}\n\n${message}`;

  const payload = {
    sender:       { name: FROM_NAME, email: FROM_EMAIL },
    to:           [{ email: TO_EMAIL, name: TO_NAME }],
    replyTo:      { email, name },
    subject:      `[WWBY Contact] ${subjectLabel} — ${name}`,
    htmlContent:  emailHtml,
    textContent:  emailText,
  };

  try {
    const resp = await fetch(BREVO_API, {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });

    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      console.error('Brevo error', resp.status, detail);
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Failed to send message', status: resp.status }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };

  } catch (err) {
    console.error('Contact function error:', err.message);
    return { statusCode: 502, headers, body: JSON.stringify({ error: 'Could not send message', detail: err.message }) };
  }
};

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
