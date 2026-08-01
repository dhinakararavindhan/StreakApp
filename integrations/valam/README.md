# VALAM ↔ Nova integration

VALAM (multi-tenant Business OS) routes all outbound messaging — OTPs, daily
owner digests, invoice reminders, Autopilot nudges — through a single
`MessageProvider` seam. Nova's messaging gateway is a real provider for that
seam: per-tenant delivery, a provider-agnostic transport layer, and a
delivery log, without VALAM holding any vendor credentials.

```
VALAM (NestJS)                          Nova CMS
┌─────────────────────┐                 ┌──────────────────────────────┐
│ OTP / digest /      │   write key    │ POST /api/teams/:id/messages │
│ reminder / nudge    ├───────────────►│  ├─ WhatsApp (Meta Cloud API)│
│  → MessageProvider  │                │  ├─ SMS (Twilio-compatible)  │
│  → NovaMessage-     │◄───────────────┤  └─ NOVA_MESSAGE_WEBHOOK     │
│    Provider         │  202 + log id  │     (MSG91 / Gupshup / DLT)  │
└─────────────────────┘                 └──────────────────────────────┘
```

## Setup

1. **One Nova company per VALAM business** (mirrors VALAM's `businessId`
   tenant scoping). Create the company, then mint a **write API key**:
   Company page → API keys → New key (scope: write). Note the `nova_…` token.
2. **Configure a transport on the Nova server** (any one):
   - WhatsApp: `WHATSAPP_TOKEN` + `WHATSAPP_PHONE_ID` (Meta Cloud API)
   - SMS: `TWILIO_SID` + `TWILIO_TOKEN` + `TWILIO_FROM`
   - Anything else (MSG91, Gupshup, DLT-registered routes):
     `NOVA_MESSAGE_WEBHOOK=<url>` — Nova POSTs
     `{channel, to, text, template}` JSON and your relay translates it to
     the vendor's API.
3. **Register the provider in VALAM** — copy `nova-message.provider.ts`
   into the API project and bind it to your `MessageProvider` injection
   token with a `resolveTenant(businessId) → {teamId, apiKey}` lookup
   (config table or env). Adapt `send()`'s signature to your exact
   interface; the method body is the integration.

## Contract

`POST /api/teams/:teamId/messages` with `Authorization: Bearer <write key>`:

| Field | Notes |
| --- | --- |
| `channel` | `"sms"` or `"whatsapp"` |
| `to` | phone number, 8–15 digits, optional `+`, separators tolerated |
| `text` | message body, ≤ 2000 chars |
| `template` | optional hint, forwarded to webhook relays |

Responses: `202` sent (`{id, provider, provider_id}`), `400` validation,
`503` channel not configured, `502` provider rejected (logged with the
error), `429` rate-limited (`RATE_LIMIT_MESSAGES`/min, default 60).
`GET` on the same path returns the latest 50 log entries for the tenant.
