import { afterEach, describe, expect, it, vi } from 'vitest';
import { GUARD, validate } from '../helpdesk-worker/src/guard.ts';
import worker from '../helpdesk-worker/src/index.ts';

const ORIGIN = 'https://finpathdev.github.io';
const env = { GEMINI_API_KEY: 'SECRET-KEY', ALLOWED_ORIGINS: ORIGIN, RATE_LIMIT: '3' };
const body = { system: 'REFERENCE…', messages: [{ role: 'user', content: 'What is cost per use?' }] };

const req = (opts: { origin?: string | null; method?: string; body?: unknown; ip?: string } = {}) =>
  new Request('https://tally-helpdesk.example.workers.dev/', {
    method: opts.method ?? 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.origin === null ? {} : { Origin: opts.origin ?? ORIGIN }),
      'CF-Connecting-IP': opts.ip ?? '1.1.1.1',
    },
    body: opts.method === 'OPTIONS' || opts.method === 'GET' ? undefined : JSON.stringify(opts.body ?? body),
  });

function geminiStream(texts: string[]) {
  const sse = texts.map((t) => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] } }] })}\r\n\r\n`).join('');
  return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

afterEach(() => vi.unstubAllGlobals());

describe('helpdesk worker', () => {
  it('answers CORS preflight for the allowed origin only', async () => {
    const ok = await worker.fetch(req({ method: 'OPTIONS' }), env);
    expect(ok.status).toBe(204);
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    const other = await worker.fetch(req({ method: 'OPTIONS', origin: 'https://evil.example' }), env);
    expect(other.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('rejects other sites and missing origins', async () => {
    expect((await worker.fetch(req({ origin: 'https://evil.example' }), env)).status).toBe(403);
    expect((await worker.fetch(req({ origin: null }), env)).status).toBe(403);
  });

  it('streams the answer as plain text, guarded, with the key kept server-side', async () => {
    const fetchMock = vi.fn().mockResolvedValue(geminiStream(['Cost per use is ', 'the monthly cost ÷ uses.']));
    vi.stubGlobal('fetch', fetchMock);
    const res = await worker.fetch(req({ ip: '2.2.2.2' }), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    const out = await res.text();
    expect(out).toBe('Cost per use is the monthly cost ÷ uses.');
    expect(out).not.toContain('SECRET-KEY');

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('generativelanguage.googleapis.com');
    expect(init.headers['x-goog-api-key']).toBe('SECRET-KEY');
    const sent = JSON.parse(init.body);
    expect(sent.systemInstruction.parts[0].text.startsWith(GUARD)).toBe(true);
    expect(sent.systemInstruction.parts[0].text).toContain('REFERENCE…');
  });

  it('uses Claude when that key is configured, without the browser header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}\n\n',
      { status: 200 },
    ));
    vi.stubGlobal('fetch', fetchMock);
    const res = await worker.fetch(req({ ip: '3.3.3.3' }), { ANTHROPIC_API_KEY: 'sk-ant', ALLOWED_ORIGINS: ORIGIN });
    expect(await res.text()).toBe('Hi');
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.headers['x-api-key']).toBe('sk-ant');
    expect(init.headers['anthropic-dangerous-direct-browser-access']).toBeUndefined();
  });

  it('rate-limits each visitor', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => geminiStream(['ok'])));
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await worker.fetch(req({ ip: '9.9.9.9' }), env)).status);
    expect(codes).toEqual([200, 200, 200, 429]);
    expect((await worker.fetch(req({ ip: '8.8.8.8' }), env)).status).toBe(200);
  });

  it('prefers a global Rate Limiting binding when present', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => geminiStream(['ok'])));
    const limiter = { limit: vi.fn().mockResolvedValue({ success: false }) };
    expect((await worker.fetch(req({ ip: '7.7.7.7' }), { ...env, RATE_LIMITER: limiter })).status).toBe(429);
    expect(limiter.limit).toHaveBeenCalledWith({ key: '7.7.7.7' });
  });

  it('does not forward provider error details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":{"message":"billing account 123 suspended"}}', { status: 403 })));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await worker.fetch(req({ ip: '4.4.4.4' }), env);
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain('billing');
  });

  it('handles an unreachable AI service with a proper error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network down')));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await worker.fetch(req({ ip: '6.6.6.6' }), env);
    expect(res.status).toBe(502);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
  });

  it('validates input size and shape', () => {
    expect(validate({ system: 'x', messages: [{ role: 'user', content: 'hi' }] })).not.toBeTypeOf('string');
    expect(validate({ system: 'x'.repeat(30_000), messages: [{ role: 'user', content: 'hi' }] })).toMatch(/oversized/);
    expect(validate({ system: 'x', messages: [{ role: 'system', content: 'hi' }] })).toMatch(/Invalid/);
    expect(validate({ system: 'x', messages: [{ role: 'user', content: 'x'.repeat(5_000) }] })).toMatch(/Invalid/);
    expect(validate({ system: 'x', messages: [{ role: 'assistant', content: 'hi' }] })).toMatch(/last message/);
    expect(validate({ system: 'x', messages: Array(13).fill({ role: 'user', content: 'a' }) })).toMatch(/Invalid/);
  });

  it('says so when no key is configured', async () => {
    expect((await worker.fetch(req({ ip: '5.5.5.5' }), { ALLOWED_ORIGINS: ORIGIN })).status).toBe(503);
  });
});
