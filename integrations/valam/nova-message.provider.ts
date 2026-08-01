/**
 * NovaMessageProvider — plugs Nova CMS's messaging gateway into VALAM's
 * MessageProvider seam.
 *
 * VALAM routes every outbound message (OTPs, owner digests, invoice
 * reminders, Autopilot nudges) through one MessageProvider interface.
 * This implementation forwards them to Nova's gateway, which fans out to
 * WhatsApp (Meta Cloud API), SMS (Twilio-compatible), or any relay behind
 * NOVA_MESSAGE_WEBHOOK (MSG91/Gupshup/DLT routes) — and keeps a delivery
 * log per tenant.
 *
 * Tenant mapping: one VALAM business ↔ one Nova company + write API key.
 * Supply a resolver from businessId to {teamId, apiKey} (from your own
 * config table, env, or a static map).
 *
 * Wiring (NestJS):
 *
 *   @Module({
 *     providers: [{
 *       provide: MESSAGE_PROVIDER, // your existing injection token
 *       useFactory: (config: ConfigService) =>
 *         new NovaMessageProvider({
 *           baseUrl: config.get('NOVA_BASE_URL'),
 *           resolveTenant: (businessId) => ({
 *             teamId: config.get(`NOVA_TEAM_${businessId}`),
 *             apiKey: config.get(`NOVA_KEY_${businessId}`),
 *           }),
 *         }),
 *       inject: [ConfigService],
 *     }],
 *   })
 *
 * The send() signature below is intentionally minimal; adapt the method
 * name/shape to your exact MessageProvider interface — the body of the
 * method is the integration.
 */

export type NovaChannel = 'sms' | 'whatsapp';

export interface NovaTenant {
  teamId: number;
  apiKey: string; // a Nova write key: nova_…
}

export interface NovaOutboundMessage {
  businessId: string;
  to: string; // E.164-ish; separators tolerated
  channel: NovaChannel;
  body: string;
  template?: string; // optional provider template hint (forwarded to webhook relays)
}

export interface NovaMessageResult {
  ok: boolean;
  id?: number; // Nova's message-log id
  provider?: string; // 'whatsapp-cloud' | 'twilio' | 'webhook'
  providerId?: string; // vendor message id (wamid…, SM…)
  error?: string;
}

export interface NovaMessageProviderOptions {
  baseUrl: string; // e.g. https://cms.example.com
  resolveTenant: (businessId: string) => NovaTenant | Promise<NovaTenant>;
  fetchImpl?: typeof fetch; // override in tests
  timeoutMs?: number;
}

export class NovaMessageProvider {
  constructor(private readonly opts: NovaMessageProviderOptions) {}

  async send(msg: NovaOutboundMessage): Promise<NovaMessageResult> {
    const { teamId, apiKey } = await this.opts.resolveTenant(msg.businessId);
    const doFetch = this.opts.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 15000);
    try {
      const res = await doFetch(`${this.opts.baseUrl}/api/teams/${teamId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          channel: msg.channel,
          to: msg.to,
          text: msg.body,
          template: msg.template,
        }),
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data.error ?? `HTTP ${res.status}` };
      return { ok: true, id: data.id, provider: data.provider, providerId: data.provider_id };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? 'network error' };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Delivery log for a tenant — surface it in the owner workspace. */
  async history(businessId: string): Promise<any[]> {
    const { teamId, apiKey } = await this.opts.resolveTenant(businessId);
    const doFetch = this.opts.fetchImpl ?? fetch;
    const res = await doFetch(`${this.opts.baseUrl}/api/teams/${teamId}/messages`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) throw new Error(`Nova message log failed: HTTP ${res.status}`);
    return res.json();
  }
}
