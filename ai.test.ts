import { describe, expect, it, vi } from 'vitest';
import {
  AIError,
  anthropicRequest,
  defaultConfig,
  explainHttp,
  extractors,
  geminiRequest,
  openaiRequest,
  sseParser,
  streamAnswer,
} from '../src/help/ai.ts';
import { referenceFor } from '../src/help/search.ts';
import { buildSystemPrompt, dataSummary, describeScreen } from '../src/help/prompt.ts';
import { demoState } from '../src/lib/schema.ts';

const msgs = [
  { role: 'user' as const, content: 'hi' },
  { role: 'assistant' as const, content: 'hello' },
  { role: 'user' as const, content: 'what is cost per use?' },
];

describe('request builders', () => {
  it('Gemini: streaming endpoint, key in header, roles mapped', () => {
    const r = geminiRequest('KEY', 'gemini-flash-latest', 'SYS', msgs);
    expect(r.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:streamGenerateContent?alt=sse');
    expect(r.headers['x-goog-api-key']).toBe('KEY');
    expect(r.url).not.toContain('KEY');
    const b = JSON.parse(r.body);
    expect(b.systemInstruction.parts[0].text).toBe('SYS');
    expect(b.contents.map((c: { role: string }) => c.role)).toEqual(['user', 'model', 'user']);
  });

  it('Claude: browser-access header, version, streaming', () => {
    const r = anthropicRequest('KEY', 'claude-haiku-4-5', 'SYS', msgs);
    expect(r.url).toBe('https://api.anthropic.com/v1/messages');
    expect(r.headers).toMatchObject({ 'x-api-key': 'KEY', 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' });
    expect(JSON.parse(r.body)).toMatchObject({ model: 'claude-haiku-4-5', system: 'SYS', stream: true, messages: msgs });
  });

  it('OpenAI-compatible: base URL, bearer auth, system message first', () => {
    const r = openaiRequest('http://localhost:11434/v1/', '', 'llama3.2', 'SYS', msgs);
    expect(r.url).toBe('http://localhost:11434/v1/chat/completions');
    expect(r.headers.Authorization).toBeUndefined(); // local servers need no key
    const b = JSON.parse(r.body);
    expect(b.messages[0]).toEqual({ role: 'system', content: 'SYS' });
    expect(openaiRequest('https://api.openai.com/v1', 'sk-x', 'm', 's', msgs).headers.Authorization).toBe('Bearer sk-x');
  });
});

describe('SSE parsing', () => {
  it('handles events split across arbitrary chunk boundaries', () => {
    const parse = sseParser();
    const wire = 'event: a\ndata: {"x":1}\n\ndata: {"x":2}\r\n\r\ndata: tail';
    const out: string[] = [];
    for (let i = 0; i < wire.length; i += 3) out.push(...parse(wire.slice(i, i + 3)).map((e) => e.data));
    out.push(...parse('', true).map((e) => e.data));
    expect(out).toEqual(['{"x":1}', '{"x":2}', 'tail']);
  });

  it('extracts text from each provider’s real stream format', () => {
    expect(extractors.gemini('{"candidates":[{"content":{"parts":[{"text":"Hel"},{"text":"lo"}],"role":"model"}}]}')).toBe('Hello');
    expect(extractors.gemini('{"candidates":[{"content":{"parts":[{"text":"thinking","thought":true},{"text":"Hi"}]}}]}')).toBe('Hi');
    expect(extractors.anthropic('{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}', 'content_block_delta')).toBe('Hi');
    expect(extractors.anthropic('{"type":"message_start","message":{}}', 'message_start')).toBeNull();
    expect(extractors.openai('{"choices":[{"delta":{"content":"Hi"}}]}')).toBe('Hi');
    expect(extractors.openai('[DONE]')).toBeNull();
    expect(() => extractors.anthropic('{"type":"error","error":{"message":"Overloaded"}}', 'error')).toThrow('Overloaded');
  });

  it('explains HTTP errors in plain words', () => {
    expect(explainHttp('gemini', 400, '{"error":{"message":"API key not valid. API_KEY_INVALID"}}')).toMatch(/didn’t accept the API key/);
    expect(explainHttp('anthropic', 429, '')).toMatch(/too many requests/);
    expect(explainHttp('openai', 404, '{"error":{"message":"models/gpt-9 not found"}}')).toMatch(/gpt-9/);
  });
});

describe('streamAnswer', () => {
  const sse = (lines: string[]) =>
    new Response(
      new ReadableStream({
        start(c) {
          const enc = new TextEncoder();
          // Deliberately awkward chunking.
          const all = lines.join('');
          for (let i = 0; i < all.length; i += 7) c.enqueue(enc.encode(all.slice(i, i + 7)));
          c.close();
        },
      }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    );

  it('streams Gemini deltas in order', async () => {
    const cfg = { ...defaultConfig(), keys: { gemini: 'k' } };
    const fetchImpl = vi.fn().mockResolvedValue(
      sse([
        'data: {"candidates":[{"content":{"parts":[{"text":"Cost per use "}]}}]}\n\n',
        'data: {"candidates":[{"content":{"parts":[{"text":"is the monthly cost…"}]}}]}\n\n',
      ]),
    );
    let text = '';
    await streamAnswer({ provider: 'gemini', cfg, system: 's', messages: msgs, onText: (d) => (text += d), fetchImpl });
    expect(text).toBe('Cost per use is the monthly cost…');
  });

  it('streams plain text from the site’s helpdesk proxy', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(new ReadableStream({
      start(c) { const e = new TextEncoder(); c.enqueue(e.encode('Settle up ')); c.enqueue(e.encode('clears every balance.')); c.close(); },
    })));
    let text = '';
    await streamAnswer({ provider: 'proxy', proxyUrl: 'https://help.example.workers.dev', cfg: defaultConfig(), system: 's', messages: msgs, onText: (d) => (text += d), fetchImpl });
    expect(text).toBe('Settle up clears every balance.');
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://help.example.workers.dev');
    expect(JSON.parse(fetchImpl.mock.calls[0]![1].body)).toEqual({ system: 's', messages: msgs });
  });

  it('turns a rejected key into an actionable error', async () => {
    const cfg = { ...defaultConfig(), keys: { anthropic: 'bad' } };
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{"error":{"message":"invalid x-api-key"}}', { status: 401 }));
    await expect(streamAnswer({ provider: 'anthropic', cfg, system: 's', messages: msgs, onText: () => {}, fetchImpl })).rejects.toThrow(AIError);
  });
});

describe('grounded prompt', () => {
  it('includes the retrieved reference, the screen and the rules', () => {
    const p = buildSystemPrompt({ reference: referenceFor('what is cost per use'), screen: describeScreen('#/subscriptions'), today: '2026-09-24' });
    expect(p).toContain('### Cost per use');
    expect(p).toContain('Subscriptions tab');
    expect(p).toMatch(/Never invent buttons/);
    expect(p).not.toContain("PERSON'S TALLY DATA");
  });

  it('summarises data without incomes', () => {
    const s = demoState('2026-09-23');
    const d = dataSummary(s, '2026-09-23');
    expect(d).toContain('Gym Membership: $45.00 monthly');
    expect(d).toContain('flags: Low value, High cost');
    expect(d).toMatch(/Suggested payments: .* pays Alex/);
    expect(d).not.toMatch(/5,?000|3,?500|income/i);
  });
});
