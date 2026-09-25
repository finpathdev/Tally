/**
 * AI providers for the helpdesk. Each cloud provider is a pure request
 * builder plus a stream parser, so they're unit-tested against the real
 * wire formats; `streamAnswer` does the network part.
 *
 * Providers:
 * - proxy:     the site's own helpdesk endpoint (see helpdesk-worker/). No setup for visitors.
 * - builtin:   Chrome's on-device model (Prompt API). Private and free; desktop Chrome only.
 * - gemini:    Google Gemini with the visitor's key (free tier available).
 * - anthropic: Claude with the visitor's key.
 * - openai:    any OpenAI-compatible endpoint (OpenAI, OpenRouter, Groq, a local Ollama…).
 */

export type ProviderId = 'proxy' | 'builtin' | 'gemini' | 'anthropic' | 'openai';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AIConfig {
  /** "auto" picks the best available provider. */
  provider: 'auto' | ProviderId;
  keys: Partial<Record<'gemini' | 'anthropic' | 'openai', string>>;
  models: Partial<Record<'gemini' | 'anthropic' | 'openai', string>>;
  openaiBaseUrl: string;
  /** Include a summary of the user's Tally data in questions. */
  shareData: boolean;
}

export const DEFAULT_MODELS = {
  // "latest" aliases follow Google's current Flash model, so this keeps working as models change.
  gemini: 'gemini-flash-latest',
  anthropic: 'claude-haiku-4-5',
  openai: 'gpt-5-mini',
} as const;

export const PROVIDER_LABEL: Record<ProviderId, string> = {
  proxy: 'Tally assistant',
  builtin: 'On-device AI (Chrome)',
  gemini: 'Google Gemini',
  anthropic: 'Claude',
  openai: 'OpenAI-compatible',
};

export const defaultConfig = (): AIConfig => ({
  provider: 'auto',
  keys: {},
  models: {},
  openaiBaseUrl: 'https://api.openai.com/v1',
  shareData: false,
});

export class AIError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export interface HttpRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

const MAX_TOKENS = 900;

// ---------- request builders ----------

export function geminiRequest(key: string, model: string, system: string, messages: ChatMessage[]): HttpRequest {
  return {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig: { temperature: 0.3, maxOutputTokens: MAX_TOKENS },
    }),
  };
}

export function anthropicRequest(key: string, model: string, system: string, messages: ChatMessage[]): HttpRequest {
  return {
    url: 'https://api.anthropic.com/v1/messages',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      // Required for calls made directly from a browser with the user's own key.
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({ model, max_tokens: MAX_TOKENS, system, messages, stream: true }),
  };
}

export function openaiRequest(baseUrl: string, key: string, model: string, system: string, messages: ChatMessage[]): HttpRequest {
  return {
    url: `${baseUrl.replace(/\/+$/, '')}/chat/completions`,
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ model, stream: true, messages: [{ role: 'system', content: system }, ...messages] }),
  };
}

export function proxyRequest(url: string, system: string, messages: ChatMessage[]): HttpRequest {
  return { url, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ system, messages }) };
}

// ---------- stream parsing ----------

/**
 * Incremental Server-Sent Events parser. Feed it raw text chunks as they
 * arrive (which may split lines or events anywhere); it returns the `data`
 * payloads of every complete event.
 */
export function sseParser() {
  let buffer = '';
  return (chunk: string, flush = false): { event?: string; data: string }[] => {
    buffer += chunk.replace(/\r\n?/g, '\n');
    const out: { event?: string; data: string }[] = [];
    let idx: number;
    const take = (block: string) => {
      let event: string | undefined;
      const data: string[] = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
        else if (line.startsWith('event:')) event = line.slice(6).trim();
      }
      if (data.length) out.push({ event, data: data.join('\n') });
    };
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      take(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 2);
    }
    if (flush && buffer.trim()) {
      take(buffer);
      buffer = '';
    }
    return out;
  };
}

type Extractor = (data: string, event?: string) => string | null;

/** Pull the text delta out of one SSE data payload, per provider. Throws AIError on in-stream errors. */
export const extractors: Record<'gemini' | 'anthropic' | 'openai', Extractor> = {
  gemini: (data) => {
    const j = JSON.parse(data);
    if (j.error) throw new AIError(j.error.message ?? 'Gemini returned an error.', j.error.code);
    const parts = j.candidates?.[0]?.content?.parts as { text?: string; thought?: boolean }[] | undefined;
    return parts?.filter((p) => !p.thought).map((p) => p.text ?? '').join('') ?? null;
  },
  anthropic: (data, event) => {
    const j = JSON.parse(data);
    if (event === 'error' || j.type === 'error') throw new AIError(j.error?.message ?? 'Claude returned an error.');
    return j.type === 'content_block_delta' && j.delta?.type === 'text_delta' ? j.delta.text : null;
  },
  openai: (data) => {
    if (data.trim() === '[DONE]') return null;
    const j = JSON.parse(data);
    if (j.error) throw new AIError(j.error.message ?? 'The provider returned an error.');
    return j.choices?.[0]?.delta?.content ?? null;
  },
};

/** Turn an HTTP error into a message a person can act on. */
export function explainHttp(provider: ProviderId, status: number, body: string): string {
  const who = PROVIDER_LABEL[provider];
  const detail = (() => {
    try {
      const j = JSON.parse(body);
      return String(j.error?.message ?? j.message ?? '');
    } catch {
      return '';
    }
  })();
  if (status === 400 && /api key|API_KEY/i.test(body)) return `${who} didn’t accept the API key. Check it in AI settings.`;
  if (status === 401 || status === 403) return `${who} didn’t accept the API key, or it doesn’t have access to this model. Check it in AI settings.`;
  if (status === 404) return `${who} couldn’t find the model “${detail.match(/models\/([\w.-]+)/)?.[1] ?? 'selected'}”. Choose another model in AI settings.`;
  if (status === 429) return `${who} is receiving too many requests (or your free quota is used up). Try again in a minute.`;
  if (status >= 500) return `${who} is having problems right now. Try again shortly.`;
  return detail ? `${who}: ${detail}` : `${who} returned an error (${status}).`;
}

// ---------- on-device (Chrome Prompt API) ----------

interface LMSession {
  promptStreaming(input: string, opts?: { signal?: AbortSignal }): ReadableStream<string>;
  destroy(): void;
}
interface LanguageModelStatic {
  availability(opts?: unknown): Promise<'unavailable' | 'downloadable' | 'downloading' | 'available'>;
  create(opts?: unknown): Promise<LMSession>;
}
const lm = (): LanguageModelStatic | undefined => (globalThis as { LanguageModel?: LanguageModelStatic }).LanguageModel;

const LM_OPTS = { expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] };

export async function builtinStatus(): Promise<'unavailable' | 'downloadable' | 'downloading' | 'available'> {
  try {
    return (await lm()?.availability(LM_OPTS)) ?? 'unavailable';
  } catch {
    return 'unavailable';
  }
}

// ---------- choosing a provider ----------

export const PROXY_URL: string | undefined = import.meta.env?.VITE_HELPDESK_URL || undefined;

export async function resolveProvider(cfg: AIConfig): Promise<ProviderId | null> {
  const hasKey = (p: 'gemini' | 'anthropic' | 'openai') => !!cfg.keys[p]?.trim() || (p === 'openai' && /localhost|127\.0\.0\.1/.test(cfg.openaiBaseUrl));
  if (cfg.provider !== 'auto') {
    if (cfg.provider === 'proxy') return PROXY_URL ? 'proxy' : null;
    if (cfg.provider === 'builtin') return (await builtinStatus()) === 'unavailable' ? null : 'builtin';
    return hasKey(cfg.provider) ? cfg.provider : null;
  }
  // Auto: the visitor's own key first (they chose it), then the site assistant, then on-device.
  for (const p of ['gemini', 'anthropic', 'openai'] as const) if (hasKey(p)) return p;
  if (PROXY_URL) return 'proxy';
  if ((await builtinStatus()) === 'available') return 'builtin';
  return null;
}

// ---------- streaming an answer ----------

export interface StreamOptions {
  provider: ProviderId;
  cfg: AIConfig;
  system: string;
  messages: ChatMessage[];
  onText: (delta: string) => void;
  onStatus?: (status: string) => void;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  /** Override the build-time proxy URL (tests). */
  proxyUrl?: string;
}

export async function streamAnswer(o: StreamOptions): Promise<void> {
  if (o.provider === 'builtin') return streamBuiltin(o);

  const req: HttpRequest =
    o.provider === 'gemini'
      ? geminiRequest(o.cfg.keys.gemini!.trim(), o.cfg.models.gemini || DEFAULT_MODELS.gemini, o.system, o.messages)
      : o.provider === 'anthropic'
        ? anthropicRequest(o.cfg.keys.anthropic!.trim(), o.cfg.models.anthropic || DEFAULT_MODELS.anthropic, o.system, o.messages)
        : o.provider === 'openai'
          ? openaiRequest(o.cfg.openaiBaseUrl, o.cfg.keys.openai?.trim() ?? '', o.cfg.models.openai || DEFAULT_MODELS.openai, o.system, o.messages)
          : proxyRequest((o.proxyUrl ?? PROXY_URL)!, o.system, o.messages);

  let res: Response;
  try {
    res = await (o.fetchImpl ?? fetch)(req.url, { method: 'POST', headers: req.headers, body: req.body, signal: o.signal });
  } catch (e) {
    if ((e as DOMException).name === 'AbortError') throw e;
    throw new AIError(`Couldn’t reach ${PROVIDER_LABEL[o.provider]}. Check your internet connection.`);
  }
  if (!res.ok || !res.body) throw new AIError(explainHttp(o.provider, res.status, await res.text().catch(() => '')), res.status);

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  if (o.provider === 'proxy') {
    // The proxy streams plain text.
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) o.onText(value);
    }
    return;
  }
  const parse = sseParser();
  const extract = extractors[o.provider];
  for (;;) {
    const { value, done } = await reader.read();
    for (const ev of parse(value ?? '', done)) {
      const text = extract(ev.data, ev.event);
      if (text) o.onText(text);
    }
    if (done) break;
  }
}

let builtinSession: { system: string; session: LMSession } | null = null;

async function streamBuiltin(o: StreamOptions): Promise<void> {
  const api = lm();
  if (!api) throw new AIError('On-device AI isn’t available in this browser.');
  // Recreate the session when the system prompt (reference + context) changes.
  if (!builtinSession || builtinSession.system !== o.system) {
    builtinSession?.session.destroy();
    const status = await builtinStatus();
    if (status === 'downloadable' || status === 'downloading') o.onStatus?.('Downloading the on-device model. This happens once and can take a few minutes…');
    const history = o.messages.slice(0, -1).map((m) => ({ role: m.role, content: m.content }));
    const session = await api.create({
      ...LM_OPTS,
      initialPrompts: [{ role: 'system', content: o.system }, ...history],
      monitor(m: EventTarget) {
        m.addEventListener('downloadprogress', (e) => {
          const loaded = (e as unknown as { loaded: number }).loaded;
          o.onStatus?.(`Downloading the on-device model… ${Math.round(loaded * 100)}%`);
        });
      },
      signal: o.signal,
    });
    builtinSession = { system: o.system, session };
  }
  o.onStatus?.('');
  const stream = builtinSession.session.promptStreaming(o.messages.at(-1)!.content, { signal: o.signal });
  const reader = stream.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) o.onText(value);
  }
}
