import { today as todayISO } from '../lib/dates.ts';
import { ARTICLES, GLOSSARY, SECTIONS, articleById, termById } from '../help/articles.ts';
import {
  type AIConfig,
  AIError,
  type ChatMessage,
  DEFAULT_MODELS,
  PROVIDER_LABEL,
  PROXY_URL,
  type ProviderId,
  builtinStatus,
  defaultConfig,
  resolveProvider,
  streamAnswer,
} from '../help/ai.ts';
import { inline, renderMarkdown } from '../help/markdown.ts';
import { buildSystemPrompt, dataSummary, describeScreen } from '../help/prompt.ts';
import { type Hit, referenceFor, search } from '../help/search.ts';
import { store } from '../store.ts';
import { button, field, h, icon, openDialog, toast } from '../ui/dom.ts';
import type { ViewContext } from './context.ts';

// ---------------------------------------------------------------------------
// AI settings: per device, never in backups or synced files.
// ---------------------------------------------------------------------------

const AI_KEY = 'tally:ai';

export function loadAI(): AIConfig {
  try {
    const raw = localStorage.getItem(AI_KEY);
    return raw ? { ...defaultConfig(), ...JSON.parse(raw) } : defaultConfig();
  } catch {
    return defaultConfig();
  }
}

function saveAI(cfg: AIConfig) {
  try {
    localStorage.setItem(AI_KEY, JSON.stringify(cfg));
  } catch {
    toast('This browser blocked saving AI settings.');
  }
}

// ---------------------------------------------------------------------------
// Conversation: shared by the Help tab and the Ask drawer.
// ---------------------------------------------------------------------------

type AIStatus = 'thinking' | 'streaming' | 'done' | 'error' | 'off' | 'stopped';

interface Exchange {
  id: number;
  q: string;
  screen: string;
  hits: Hit[];
  ai: { status: AIStatus; text: string; provider?: ProviderId; note?: string; error?: string };
  ctrl?: AbortController;
}

const convo: Exchange[] = [];
let seq = 0;
let draft = '';
const logs = new Set<HTMLElement>();

function repaintLogs() {
  for (const log of [...logs]) {
    if (!log.isConnected) {
      logs.delete(log);
      continue;
    }
    log.replaceChildren(...convo.map(exchangeView));
    log.lastElementChild?.scrollIntoView({ block: 'nearest' });
  }
  // Suggestions only make sense before the first question; Clear only after.
  document.querySelectorAll<HTMLElement>('.chat .suggestions').forEach((el) => (el.hidden = convo.length > 0));
  document.querySelectorAll<HTMLElement>('.chat .clear-convo').forEach((el) => (el.hidden = convo.length === 0));
}

let pending = false;
function repaintAI(ex: Exchange) {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    document.querySelectorAll(`[data-ex="${ex.id}"] .ai-answer`).forEach((el) => el.replaceWith(aiView(ex)));
  });
}

export async function ask(question: string, screenHash = location.hash) {
  const q = question.trim();
  if (!q) return;
  const ex: Exchange = { id: ++seq, q, screen: screenHash, hits: search(q, 3), ai: { status: 'thinking', text: '' } };
  convo.push(ex);
  repaintLogs();

  const cfg = loadAI();
  const provider = await resolveProvider(cfg);
  if (!provider) {
    ex.ai.status = 'off';
    repaintAI(ex);
    return;
  }
  ex.ai.provider = provider;

  // Earlier finished exchanges give the model conversational context.
  const history: ChatMessage[] = convo
    .filter((e) => e !== ex && e.ai.status === 'done' && e.ai.text)
    .slice(-3)
    .flatMap((e) => [{ role: 'user' as const, content: e.q }, { role: 'assistant' as const, content: e.ai.text }]);
  const prevQ = history.at(-2)?.content ?? '';
  const today = todayISO();
  const system = buildSystemPrompt({
    reference: referenceFor(`${q} ${prevQ}`),
    screen: describeScreen(screenHash),
    today,
    data: cfg.shareData ? dataSummary(store.state, today) : undefined,
  });

  ex.ctrl = new AbortController();
  try {
    await streamAnswer({
      provider,
      cfg,
      system,
      messages: [...history, { role: 'user', content: q }],
      signal: ex.ctrl.signal,
      onStatus: (note) => {
        ex.ai.note = note;
        repaintAI(ex);
      },
      onText: (d) => {
        ex.ai.status = 'streaming';
        ex.ai.text += d;
        repaintAI(ex);
      },
    });
    ex.ai.status = ex.ai.text.trim() ? 'done' : 'error';
    if (!ex.ai.text.trim()) ex.ai.error = 'The assistant returned an empty answer. Try rephrasing the question.';
  } catch (e) {
    if ((e as DOMException).name === 'AbortError') ex.ai.status = 'stopped';
    else {
      ex.ai.status = 'error';
      ex.ai.error = e instanceof AIError ? e.message : 'Something went wrong while asking the assistant.';
    }
  } finally {
    ex.ctrl = undefined;
    ex.ai.note = undefined;
    repaintAI(ex);
  }
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

function kbCard(ex: Exchange): HTMLElement {
  const [top, ...others] = ex.hits;
  if (!top) {
    return h('div', { class: 'kb-card empty-kb' },
      h('p', { class: 'eyebrow' }, 'Tally Help'),
      h('p', null, 'Nothing in the help library matches that directly. Try other words, or browse the topics below.'));
  }
  const article = top.kind === 'article' ? top.article : top.term.article ? articleById(top.term.article) : undefined;
  // Related links: other articles only, never the one already shown.
  const seen = new Set([article?.id]);
  const rest = others.filter((r) => {
    const id = r.kind === 'article' ? r.id : r.term.article;
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return h(
    'div',
    { class: 'kb-card' },
    h('p', { class: 'eyebrow' }, icon('book-open', 13), ' From Tally Help'),
    top.kind === 'term'
      ? [h('p', { class: 'kb-title' }, top.term.term), h('p', null, top.term.definition)]
      : [h('p', { class: 'kb-title' }, top.article.title), h('p', null, ...inline(top.article.summary))],
    article
      ? h('details', { class: 'kb-more' },
          h('summary', null, top.kind === 'term' ? `More: ${article.title}` : 'Read the full article'),
          h('div', { class: 'md' }, renderMarkdown(article.body)),
          article.link ? h('a', { class: 'btn btn-ghost btn-sm', href: article.link.href }, h('span', null, article.link.label)) : null)
      : null,
    rest.length
      ? h('p', { class: 'kb-related' }, 'Related: ',
          rest.map((r) => {
            const title = r.kind === 'article' ? r.article.title : r.term.term;
            const target = r.kind === 'article' ? r.id : r.term.article;
            return h('a', { href: target ? `#/help/${target}` : '#/help', class: 'chip' }, title);
          }))
      : null,
  );
}

function aiView(ex: Exchange): HTMLElement {
  const a = ex.ai;
  const label = a.provider ? PROVIDER_LABEL[a.provider] : '';
  if (a.status === 'off') {
    // Offer setup only on the latest question, not on every one.
    if (convo.at(-1) !== ex) return h('div', { class: 'ai-answer' });
    return h('div', { class: 'ai-answer ai-off' },
      icon('sparkles', 16),
      h('p', null, 'Want an AI-written answer too? Turn on the AI assistant. A free Google Gemini key takes about a minute.'),
      h('a', { class: 'btn btn-ghost btn-sm', href: '#/help/settings' }, icon('settings', 15), h('span', null, 'Set up AI answers')));
  }
  if (a.status === 'thinking' && !a.text) {
    return h('div', { class: 'ai-answer', 'aria-live': 'polite' },
      h('p', { class: 'eyebrow' }, icon('bot', 13), ` AI answer · ${label}`),
      h('p', { class: 'thinking' }, a.note || 'Thinking', a.note ? null : h('span', { class: 'dots', 'aria-hidden': 'true' })),
      stopButton(ex));
  }
  if (a.status === 'error') {
    return h('div', { class: 'ai-answer ai-error', role: 'alert' },
      h('p', { class: 'eyebrow' }, icon('bot', 13), ` AI answer · ${label}`),
      h('p', null, a.error ?? 'The assistant couldn’t answer.'),
      h('a', { class: 'btn btn-ghost btn-sm', href: '#/help/settings' }, icon('settings', 15), h('span', null, 'AI settings')));
  }
  return h('div', { class: 'ai-answer', 'aria-live': a.status === 'streaming' ? 'off' : 'polite' },
    h('p', { class: 'eyebrow' }, icon('bot', 13), ` AI answer · ${label}`),
    h('div', { class: 'md' }, renderMarkdown(a.text)),
    a.status === 'streaming' ? stopButton(ex) : null,
    a.status === 'stopped' ? h('p', { class: 'hint' }, 'Stopped.') : null,
    a.status === 'done' ? h('p', { class: 'ai-disclaimer' }, 'AI can make mistakes. Check important details in the articles above.') : null);
}

function stopButton(ex: Exchange) {
  return button('Stop', () => ex.ctrl?.abort(), { small: true, variant: 'quiet', icon: 'square' });
}

function exchangeView(ex: Exchange): HTMLElement {
  return h('div', { class: 'ex', dataset: { ex: String(ex.id) } },
    h('p', { class: 'q-bubble' }, ex.q),
    kbCard(ex),
    aiView(ex));
}

const SUGGESTIONS: Record<string, string[]> = {
  subscriptions: ['Why is a subscription flagged?', 'What does cost per use mean?', 'How do I find subscriptions in my bank statement?'],
  split: ['How does splitting by income work?', 'What does settle up do?', 'How do I share this with my friends?'],
  cart: ['Are groceries taxed?', 'How do I set my sales tax rate?', 'What does the striped bar mean?'],
  sync: ['Do I need GitHub?', 'How do I create a fine-grained token?', 'What happens if I forget my passphrase?'],
  help: ['What does Tally do?', 'Is my data safe?', 'How do I install Tally on my phone?'],
};

/** The question box plus conversation. Used on the Help tab and in the drawer. */
export function chatPanel(where: 'tab' | 'drawer', screenHash = () => location.hash): HTMLElement {
  const log = h('div', { class: 'chat-log', role: 'log', 'aria-label': 'Help conversation', 'aria-live': 'polite' }, ...convo.map(exchangeView));
  logs.add(log);
  const cfg = loadAI();
  const tab = screenHash().replace(/^#\/?/, '').split('/')[0] || 'subscriptions';
  const input = h('input', {
    type: 'text',
    name: 'q',
    value: draft,
    placeholder: 'Ask about any feature or money term…',
    'aria-label': 'Your question',
    autocomplete: 'off',
    enterKeyHint: 'send',
    dataset: { key: `ask-${where}` },
    onInput: (e: Event) => { draft = (e.target as HTMLInputElement).value; },
  });
  const form = h('form', { class: 'composer' },
    icon('message-circle-question-mark', 18),
    input,
    button('Ask', () => {}, { type: 'submit', variant: 'primary', icon: 'send', small: true }));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = draft.trim();
    if (!q) return;
    draft = '';
    input.value = '';
    void ask(q, screenHash());
  });

  const share = h('label', { class: 'check share-toggle', title: 'Lets the assistant see a summary of your subscriptions, balances and cart (never incomes or tokens) so it can answer about your own numbers.' },
    h('input', {
      type: 'checkbox',
      checked: cfg.shareData,
      onChange: (e: Event) => saveAI({ ...loadAI(), shareData: (e.target as HTMLInputElement).checked }),
    }),
    'Let the AI see my Tally data');

  return h('div', { class: ['chat', `chat-${where}`] },
    log,
    h('div', { class: 'suggestions', hidden: convo.length > 0 },
      (SUGGESTIONS[tab] ?? SUGGESTIONS.help!).map((s) => h('button', { type: 'button', class: 'chip', onClick: () => void ask(s, screenHash()) }, s))),
    form,
    h('div', { class: 'composer-foot' },
      share,
      Object.assign(button('Clear conversation', () => { convo.length = 0; repaintLogs(); }, { small: true, variant: 'quiet' }), { hidden: convo.length === 0, className: 'btn btn-quiet btn-sm clear-convo' })),
  );
}

// ---------------------------------------------------------------------------
// Ask drawer (available on every screen)
// ---------------------------------------------------------------------------

export function openAskDrawer(question?: string) {
  const from = location.hash;
  document.querySelector<HTMLDialogElement>('dialog.drawer')?.close();
  const dialog = h('dialog', { class: 'drawer', 'aria-labelledby': 'drawer-title' });
  dialog.append(
    h('header', { class: 'drawer-head' },
      h('h2', { id: 'drawer-title' }, 'Help desk'),
      h('a', { class: 'btn btn-quiet btn-sm', href: '#/help', onClick: () => dialog.close() }, icon('book-open', 15), h('span', null, 'All help')),
      button('', () => dialog.close(), { icon: 'x', title: 'Close', variant: 'quiet' })),
    chatPanel('drawer', () => from),
  );
  dialog.addEventListener('close', () => dialog.remove());
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  document.body.appendChild(dialog);
  dialog.showModal();
  if (question) void ask(question, from);
  else dialog.querySelector<HTMLInputElement>('.composer input')?.focus();
}

/** A small "?" button that explains a term in place. */
export function helpTip(termId: string): HTMLElement {
  const t = termById(termId);
  if (!t) return h('span');
  return h('button', {
    type: 'button',
    class: 'tip',
    'aria-label': `What is “${t.term}”?`,
    title: `What is “${t.term}”?`,
    onClick: (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      const article = t.article ? articleById(t.article) : undefined;
      const d = openDialog({
        title: t.term,
        submitLabel: 'Got it',
        infoOnly: true,
        body: () => h('div', { class: 'tip-body' },
          h('p', null, t.definition),
          h('div', { class: 'row wrap' },
            article ? h('a', { class: 'btn btn-ghost btn-sm', href: `#/help/${article.id}`, onClick: () => d.close() }, icon('book-open', 15), h('span', null, 'Read more')) : null,
            button('Ask the help desk', () => { d.close(); openAskDrawer(`Explain “${t.term}” in Tally with an example.`); }, { small: true, icon: 'message-circle-question-mark' }))),
        onSubmit: () => {},
      });
    },
  }, icon('circle-question-mark', 14));
}

// ---------------------------------------------------------------------------
// Help tab
// ---------------------------------------------------------------------------

let glossaryFilter = '';

export function helpView(ctx: ViewContext): HTMLElement {
  return h(
    'section',
    { class: 'view help-view', 'aria-labelledby': 'help-title' },
    h('div', { class: 'toolbar' },
      h('h2', { id: 'help-title', class: 'section-title' }, 'Help'),
      h('p', { class: 'muted' }, 'Ask anything about Tally or a money term. Answers come from Tally’s help library, plus AI if you turn it on.'),
      h('span', { class: 'spacer' }),
      aiStatusChip()),
    h('div', { class: 'card ask-card' }, chatPanel('tab')),
    h('div', { class: 'help-grid' },
      h('div', { class: 'topics' },
        h('h3', { class: 'sub-title' }, 'Browse by topic'),
        SECTIONS.map((section) =>
          h('div', { class: 'card topic' },
            h('h4', null, section),
            ARTICLES.filter((a) => a.section === section).map((a) =>
              h('details', { class: 'article', id: `help-${a.id}` },
                h('summary', null, a.title),
                h('div', { class: 'md' }, renderMarkdown(a.body)),
                h('div', { class: 'row wrap' },
                  a.link ? h('a', { class: 'btn btn-ghost btn-sm', href: a.link.href }, h('span', null, a.link.label)) : null,
                  button('Ask a follow-up', () => openAskDrawer(`About “${a.title}”: `.trim()), { small: true, variant: 'quiet', icon: 'message-circle-question-mark' }))))))),
      h('div', { class: 'side' },
        glossaryCard(ctx),
        aiSettingsCard(ctx))),
  );
}

function glossaryCard(ctx: ViewContext): HTMLElement {
  const f = glossaryFilter.trim().toLowerCase();
  const terms = [...GLOSSARY]
    .sort((a, b) => a.term.localeCompare(b.term))
    .filter((t) => !f || [t.term, ...t.aliases, t.definition].some((s) => s.toLowerCase().includes(f)));
  return h('div', { class: 'card glossary', id: 'help-glossary' },
    h('h3', { class: 'sub-title' }, 'What does it mean?'),
    h('label', { class: 'search' }, icon('search', 16),
      h('input', {
        type: 'search', value: glossaryFilter, placeholder: 'Filter terms', 'aria-label': 'Filter glossary terms',
        dataset: { key: 'glossary-filter' },
        onInput: (e: Event) => { glossaryFilter = (e.target as HTMLInputElement).value; ctx.rerender(); },
      })),
    terms.length
      ? h('dl', null, terms.flatMap((t) => [
          h('dt', null, t.term),
          h('dd', null, t.definition, t.article ? [' ', h('a', { href: `#/help/${t.article}` }, 'More')] : null),
        ]))
      : h('p', { class: 'hint' }, 'No terms match. Try asking the help desk instead.'));
}

function aiStatusChip(): HTMLElement {
  const chip = h('a', { class: 'ai-chip', href: '#/help/settings' }, icon('bot', 15), h('span', null, 'Checking AI…'));
  void resolveProvider(loadAI()).then((p) => {
    chip.replaceChildren(icon('bot', 15), h('span', null, p ? `AI: ${PROVIDER_LABEL[p]}` : 'AI answers off'));
    chip.classList.toggle('on', !!p);
  });
  return chip;
}

let testResult = '';

function aiSettingsCard(ctx: ViewContext): HTMLElement {
  const cfg = loadAI();
  const update = (patch: Partial<AIConfig>, rerender = false) => {
    saveAI({ ...loadAI(), ...patch });
    if (rerender) ctx.rerender();
  };
  const keyField = (p: 'gemini' | 'anthropic' | 'openai', label: string, placeholder: string) =>
    field(label, h('input', {
      type: 'password', value: cfg.keys[p] ?? '', placeholder, autocomplete: 'off', spellcheck: false,
      dataset: { key: `ai-key-${p}` },
      onChange: (e: Event) => update({ keys: { ...loadAI().keys, [p]: (e.target as HTMLInputElement).value.trim() } }, true),
    }));
  const modelField = (p: 'gemini' | 'anthropic' | 'openai') =>
    field('Model', h('input', {
      value: cfg.models[p] ?? '', placeholder: DEFAULT_MODELS[p], autocomplete: 'off', spellcheck: false,
      dataset: { key: `ai-model-${p}` },
      onChange: (e: Event) => update({ models: { ...loadAI().models, [p]: (e.target as HTMLInputElement).value.trim() } }),
    }), 'Leave blank for the default.');

  const builtin = h('span', { class: 'hint' }, 'Checking…');
  void builtinStatus().then((s) => {
    builtin.textContent = {
      available: 'Ready on this device.',
      downloadable: 'Supported. The model downloads the first time you ask (several GB, once).',
      downloading: 'Downloading the model…',
      unavailable: 'Not available in this browser. Needs recent desktop Chrome on a capable computer.',
    }[s];
  });

  const options: [AIConfig['provider'], string][] = [
    ['auto', 'Automatic (recommended)'],
    ...(PROXY_URL ? [['proxy', PROVIDER_LABEL.proxy] as [AIConfig['provider'], string]] : []),
    ['builtin', PROVIDER_LABEL.builtin],
    ['gemini', PROVIDER_LABEL.gemini],
    ['anthropic', PROVIDER_LABEL.anthropic],
    ['openai', PROVIDER_LABEL.openai],
  ];

  return h('div', { class: 'card ai-settings', id: 'help-settings' },
    h('h3', { class: 'sub-title' }, icon('bot', 18), ' AI assistant'),
    h('p', { class: 'hint' }, 'The help library always answers. Add an AI provider for written answers to any question, including ones about your own numbers.'),
    field('Answer with', h('select', {
      dataset: { key: 'ai-provider' },
      onChange: (e: Event) => update({ provider: (e.target as HTMLSelectElement).value as AIConfig['provider'] }, true),
    }, options.map(([v, l]) => h('option', { value: v, selected: v === cfg.provider }, l))),
    'Automatic uses your own key if you add one, then this site’s assistant (if it has one), then on-device AI.'),

    h('details', { class: 'provider', open: cfg.provider === 'gemini' || (cfg.provider === 'auto' && !cfg.keys.anthropic && !cfg.keys.openai) },
      h('summary', null, h('strong', null, 'Google Gemini'), h('span', { class: 'tag' }, 'free tier')),
      h('ol', { class: 'steps-mini' },
        h('li', null, 'Open ', h('a', { href: 'https://aistudio.google.com/apikey', target: '_blank', rel: 'noopener noreferrer' }, 'Google AI Studio → API keys'), ' and sign in.'),
        h('li', null, 'Click ', h('strong', null, 'Create API key'), ', then copy it.'),
        h('li', null, 'Paste it below. That’s it.')),
      keyField('gemini', 'Gemini API key', 'AIza…'),
      modelField('gemini')),
    h('details', { class: 'provider', open: cfg.provider === 'anthropic' },
      h('summary', null, h('strong', null, 'Claude (Anthropic)')),
      h('p', { class: 'hint' }, 'Create a key at ', h('a', { href: 'https://platform.claude.com/settings/keys', target: '_blank', rel: 'noopener noreferrer' }, 'the Claude Console'), '. Usage is billed to your account.'),
      keyField('anthropic', 'Claude API key', 'sk-ant-…'),
      modelField('anthropic')),
    h('details', { class: 'provider', open: cfg.provider === 'openai' },
      h('summary', null, h('strong', null, 'OpenAI-compatible')),
      h('p', { class: 'hint' }, 'OpenAI, OpenRouter, Groq, or a model on your own computer (Ollama, LM Studio). A local server needs no key.'),
      field('Base URL', h('input', {
        value: cfg.openaiBaseUrl, spellcheck: false, dataset: { key: 'ai-openai-base' },
        onChange: (e: Event) => update({ openaiBaseUrl: (e.target as HTMLInputElement).value.trim() || defaultConfig().openaiBaseUrl }, true),
      }), 'For Ollama: http://localhost:11434/v1'),
      keyField('openai', 'API key', 'sk-…'),
      modelField('openai')),
    h('div', { class: 'provider-static' }, h('strong', null, PROVIDER_LABEL.builtin), ' ', builtin),
    PROXY_URL ? h('div', { class: 'provider-static' }, h('strong', null, PROVIDER_LABEL.proxy), ' ', h('span', { class: 'hint' }, 'Provided by this site. No setup needed.')) : null,

    h('div', { class: 'row wrap' },
      button('Test the assistant', async () => {
        const provider = await resolveProvider(loadAI());
        if (!provider) {
          testResult = 'No AI provider is set up yet. Add a key above.';
          return ctx.rerender();
        }
        testResult = `Asking ${PROVIDER_LABEL[provider]}…`;
        ctx.rerender();
        let text = '';
        try {
          await streamAnswer({ provider, cfg: loadAI(), system: 'Reply with exactly: Tally assistant is working.', messages: [{ role: 'user', content: 'Test' }], onText: (d) => (text += d) });
          testResult = text.trim() ? `✓ ${PROVIDER_LABEL[provider]} replied: “${text.trim().slice(0, 80)}”` : 'The provider replied with an empty answer.';
        } catch (e) {
          testResult = e instanceof AIError ? e.message : 'The test failed.';
        }
        ctx.rerender();
      }, { small: true, variant: 'primary', icon: 'bot', key: 'ai-test' }),
      Object.values(cfg.keys).some(Boolean)
        ? button('Remove saved keys', () => { update({ keys: {} }, true); testResult = ''; toast('Removed AI keys from this browser.'); }, { small: true, variant: 'quiet', icon: 'trash' })
        : null),
    testResult ? h('p', { class: 'test-result', role: 'status' }, testResult) : null,
    h('p', { class: 'hint privacy-note' }, icon('lock', 13),
      ' Keys are saved only in this browser and sent only to the provider you chose. They’re never included in backups or synced files. Your questions go to that provider; your Tally data is included only if you tick “Let the AI see my Tally data”.'));
}

/** Handle #/help/<article | settings | glossary> after render. */
export function focusHelpTarget(target: string) {
  const el = document.getElementById(`help-${target}`);
  if (!el) return;
  if (el instanceof HTMLDetailsElement) el.open = true;
  el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  (el.querySelector('summary, input, select') as HTMLElement | null)?.focus({ preventScroll: true });
}
