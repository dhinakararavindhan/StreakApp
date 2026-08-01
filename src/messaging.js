/** Outbound WhatsApp + SMS, dependency-free. Per-channel transports:

    WhatsApp — the Meta WhatsApp Cloud API:
      WHATSAPP_TOKEN     Bearer token for the Cloud API
      WHATSAPP_PHONE_ID  the sending phone-number ID
      WHATSAPP_API_BASE  override for tests (default https://graph.facebook.com/v21.0)

    SMS — any Twilio-compatible Messages API:
      TWILIO_SID / TWILIO_TOKEN / TWILIO_FROM
      TWILIO_API_BASE    override for tests (default https://api.twilio.com)

    Either channel falls back to NOVA_MESSAGE_WEBHOOK — a JSON POST of
    {channel, to, text, template} to any URL — which is how India-first
    gateways (MSG91, Gupshup, DLT-registered routes) plug in: a tiny relay
    translates that payload into the vendor's API. With nothing set, the
    channel reports as not configured and the API answers 503. */

const CHANNELS = ['sms', 'whatsapp'];

function channelEnabled(channel) {
  if (process.env.NOVA_MESSAGE_WEBHOOK) return true;
  if (channel === 'whatsapp') return Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID);
  if (channel === 'sms') return Boolean(process.env.TWILIO_SID && process.env.TWILIO_TOKEN && process.env.TWILIO_FROM);
  return false;
}

function messagingEnabled() {
  return CHANNELS.some(channelEnabled);
}

async function postJson(url, { headers = {}, body }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      signal: controller.signal,
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = (data.error && (data.error.message || data.error)) || data.message || res.status;
      throw new Error(`Provider rejected the message: ${detail}`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function sendWhatsApp({ to, text }) {
  const base = process.env.WHATSAPP_API_BASE || 'https://graph.facebook.com/v21.0';
  const data = await postJson(`${base}/${process.env.WHATSAPP_PHONE_ID}/messages`, {
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` },
    body: {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { body: text },
    },
  });
  return { provider: 'whatsapp-cloud', providerId: (data.messages && data.messages[0] && data.messages[0].id) || '' };
}

async function sendSms({ to, text }) {
  const base = process.env.TWILIO_API_BASE || 'https://api.twilio.com';
  const sid = process.env.TWILIO_SID;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(`${base}/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${process.env.TWILIO_TOKEN}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      signal: controller.signal,
      body: new URLSearchParams({ From: process.env.TWILIO_FROM, To: to, Body: text }).toString(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Provider rejected the message: ${data.message || res.status}`);
    return { provider: 'twilio', providerId: data.sid || '' };
  } finally {
    clearTimeout(timer);
  }
}

async function sendViaWebhook({ channel, to, text, template }) {
  await postJson(process.env.NOVA_MESSAGE_WEBHOOK, { body: { channel, to, text, template: template || null } });
  return { provider: 'webhook', providerId: '' };
}

/** Send one message. Resolves {provider, providerId}; rejects on transport
    or provider errors — callers own retry/logging policy. Direct provider
    credentials win over the generic webhook relay. */
async function sendMessage({ channel, to, text, template }) {
  if (channel === 'whatsapp' && process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID) {
    return sendWhatsApp({ to, text });
  }
  if (channel === 'sms' && process.env.TWILIO_SID && process.env.TWILIO_TOKEN && process.env.TWILIO_FROM) {
    return sendSms({ to, text });
  }
  if (process.env.NOVA_MESSAGE_WEBHOOK) return sendViaWebhook({ channel, to, text, template });
  throw new Error(`The ${channel} channel is not configured`);
}

/** Loose E.164: digits with an optional +, 8–15 digits, separators tolerated. */
function normalizePhone(raw) {
  const cleaned = String(raw || '').replace(/[\s().-]/g, '');
  return /^\+?[0-9]{8,15}$/.test(cleaned) ? cleaned : null;
}

module.exports = { CHANNELS, channelEnabled, messagingEnabled, sendMessage, normalizePhone };
