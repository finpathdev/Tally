/**
 * Tally helpdesk proxy — a Cloudflare Worker.
 *
 * Lets every visitor of your Tally site get AI answers without their own API
 * key. Your key stays here, server-side. Deploy guide: helpdesk-worker/README.md.
 *
 * Environment:
 *   GEMINI_API_KEY or ANTHROPIC_API_KEY   (secret; set one)
 *   ALLOWED_ORIGINS   comma-separated, e.g. "https://you.github.io"
 *   MODEL             optional model override
 *   RATE_LIMIT        optional, requests per IP per hour (default 30)
 *
 * It reuses the app's own request builders and stream parsers
 * (src/help/ai.ts), so the site and the proxy speak exactly the same formats.
 */
// Keep the entry module's only export the handler: the Workers runtime treats
// every named export here as an entrypoint and refuses to start otherwise.
import { GUARD, validate } from './guard.ts';
import {
  DEFAULT_MODELS,
  anthropicRequest,
  extractors,
  geminiRequest,
  sseParser,
} from '../../src/help/ai.ts';

export interface Env {
  GEMINI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  ALLOWED_ORIGINS?: string;
  MODEL?: string;
  RATE_LIMIT?: string;
  /** Optional Cloudflare Rate Limiting binding (see wrangler.toml). */
  RATE_LIMITER?: { limit(o: { key: string }): Promise<{ success: boolean }> };
}

// Fallback limiter (per isolate). Use the RATE_LIMITER binding for a global limit.
const hits = new Map<string, { n: number; reset: number }>();
function allowLocal(ip: string, perHour: number, now = Date.now()): boolean {
  const e = hits.get(ip);
  if (!e || e.reset < now) {
    hits.set(ip, { n: 1, reset: now + 3_600_000 });
    if (hits.size > 5_000) hits.clear();
    return true;
  }
  e.n++;
  return e.n <= perHour;
}

function cors(origin: string | null, allowed: string[]): Record<string, string> {
  const ok = origin && allowed.includes(origin);
  return {
    ...(ok ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

const text = (status: number, body: string, headers: Record<string, string>) =>
  new Response(body, { status, headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' } });

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const origin = req.headers.get('Origin');
    const headers = cors(origin, allowed);

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (req.method !== 'POST') return text(405, 'Use POST.', headers);
    if (!origin || !allowed.includes(origin)) return text(403, 'This site isn’t allowed to use this helpdesk.', headers);

    const provider = env.GEMINI_API_KEY ? 'gemini' : env.ANTHROPIC_API_KEY ? 'anthropic' : null;
    if (!provider) return text(503, 'The helpdesk isn’t configured yet.', headers);

    const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
    const perHour = Number(env.RATE_LIMIT) || 30;
    const allowedNow = env.RATE_LIMITER ? (await env.RATE_LIMITER.limit({ key: ip })).success : allowLocal(ip, perHour);
    if (!allowedNow) return text(429, 'Too many questions from this network. Try again later.', headers);

    let parsed: ReturnType<typeof validate>;
    try {
      parsed = validate(await req.json());
    } catch {
      parsed = 'Invalid JSON.';
    }
    if (typeof parsed === 'string') return text(400, parsed, headers);

    const system = GUARD + parsed.system;
    const upstreamReq =
      provider === 'gemini'
        ? geminiRequest(env.GEMINI_API_KEY!, env.MODEL || DEFAULT_MODELS.gemini, system, parsed.messages)
        : anthropicRequest(env.ANTHROPIC_API_KEY!, env.MODEL || DEFAULT_MODELS.anthropic, system, parsed.messages);
    // Server-to-server: the browser-access header isn't needed.
    delete upstreamReq.headers['anthropic-dangerous-direct-browser-access'];

    let upstream: Response;
    try {
      upstream = await fetch(upstreamReq.url, { method: 'POST', headers: upstreamReq.headers, body: upstreamReq.body });
    } catch (e) {
      console.log('upstream unreachable', String(e));
      return text(502, 'The helpdesk couldn’t reach the AI service. Try again shortly.', headers);
    }
    if (!upstream.ok || !upstream.body) {
      // Don't forward provider error bodies (they can mention account details).
      console.log('upstream error', upstream.status, (await upstream.text().catch(() => '')).slice(0, 500));
      const status = upstream.status === 429 ? 429 : 502;
      return text(status, status === 429 ? 'The helpdesk is busy. Try again in a minute.' : 'The helpdesk couldn’t get an answer right now.', headers);
    }

    // Re-stream as plain text deltas.
    const parse = sseParser();
    const extract = extractors[provider];
    const enc = new TextEncoder();
    const out = upstream.body.pipeThrough(new TextDecoderStream()).pipeThrough(
      new TransformStream<string, Uint8Array>({
        transform(chunk, ctrl) {
          for (const ev of parse(chunk)) {
            try {
              const t = extract(ev.data, ev.event);
              if (t) ctrl.enqueue(enc.encode(t));
            } catch {
              ctrl.enqueue(enc.encode('\n\n(The answer was interrupted. Please try again.)'));
            }
          }
        },
        flush(ctrl) {
          for (const ev of parse('', true)) {
            try {
              const t = extract(ev.data, ev.event);
              if (t) ctrl.enqueue(enc.encode(t));
            } catch {
              /* ignore trailing errors */
            }
          }
        },
      }),
    );
    return new Response(out, { headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
  },
};
