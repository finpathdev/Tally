import { ARTICLES, type Article, GLOSSARY, type Term } from './articles.ts';

/**
 * Offline help search: BM25 ranking over the help library with field
 * weights, light stemming and a synonym table for the words people actually
 * use ("notification" → reminders, "roommates" → split). No network, no
 * model; it always works, and it also chooses which articles the AI
 * assistant receives as reference.
 */

export type Hit =
  | { kind: 'article'; id: string; score: number; article: Article }
  | { kind: 'term'; id: string; score: number; term: Term };

const STOP = new Set(
  'a an and are as at be by can could do does did for from get got how i if in into is it its me my of on or should so than that the their them then there these this to was what when where which who why will with would you your tally'.split(' '),
);

/** Words people type → words the help library uses. */
const SYNONYMS: Record<string, string[]> = {
  notification: ['reminder', 'notify', 'alert'],
  notify: ['reminder', 'notification'],
  alert: ['reminder', 'issue', 'notification'],
  email: ['alert', 'issue', 'notification'],
  remind: ['reminder'],
  phone: ['iphone', 'android', 'mobile', 'install'],
  mobile: ['iphone', 'android', 'install'],
  app: ['install'],
  roommate: ['split', 'share', 'group'],
  housemate: ['split', 'share', 'group'],
  friend: ['split', 'share', 'group'],
  trip: ['split', 'group', 'currency'],
  owe: ['balance', 'settle'],
  pay: ['settle', 'charge', 'payment'],
  payback: ['settle'],
  bill: ['charge', 'renewal', 'billing'],
  renew: ['renewal', 'charge', 'next'],
  charge: ['renewal', 'billing'],
  cancel: ['pause', 'delete', 'what', 'save'],
  save: ['saving', 'backup'],
  money: ['cost', 'total', 'spend'],
  spend: ['cost', 'total'],
  expensive: ['cost', 'high', 'forecast'],
  cost: ['total', 'price'],
  price: ['cost', 'history'],
  increase: ['price', 'history', 'up'],
  raise: ['price', 'history', 'up'],
  secure: ['privacy', 'encrypt', 'safe'],
  safe: ['privacy', 'secure', 'encrypt'],
  private: ['privacy', 'encrypt'],
  password: ['passphrase', 'token', 'encrypt'],
  encrypt: ['encryption', 'passphrase'],
  github: ['sync', 'repository', 'commit'],
  cloud: ['sync', 'privacy'],
  backup: ['export', 'restore'],
  export: ['backup', 'ics', 'csv'],
  import: ['csv', 'bank', 'restore'],
  statement: ['bank', 'csv'],
  bank: ['csv', 'import'],
  blank: ['white', 'deploy', 'start'],
  broken: ['troubleshooting', 'error', 'fail'],
  error: ['fail', 'troubleshooting'],
  wrong: ['error', 'mistake'],
  delete: ['remove', 'erase', 'pause'],
  remove: ['delete', 'erase'],
  grocery: ['cart', 'shopping', 'tax'],
  groceries: ['cart', 'shopping', 'tax'],
  shop: ['cart', 'shopping'],
  shopping: ['cart', 'shop'],
  calendar: ['ics', 'forecast'],
  google: ['ics', 'calendar', 'gemini'],
  fair: ['income', 'split'],
  salary: ['income'],
  earn: ['income'],
  ai: ['assistant', 'helpdesk'],
  chatbot: ['assistant', 'ai'],
  dark: ['theme'],
  night: ['theme', 'dark'],
};

/** Crude but consistent stemmer: good enough for a 40-article library. */
export function stem(w: string): string {
  if (w.length <= 3) return w;
  for (const [suf, rep] of [['ies', 'y'], ['ing', ''], ['ied', 'y'], ['ed', ''], ['es', ''], ['s', '']] as const) {
    if (w.endsWith(suf) && w.length - suf.length >= 3) return w.slice(0, -suf.length) + rep;
  }
  return w;
}

export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’']/g, '')
    .split(/[^a-z0-9%]+/)
    .filter((t) => t && !STOP.has(t))
    .map(stem);
}

type HitBase = { kind: 'article'; id: string; article: Article } | { kind: 'term'; id: string; term: Term };

interface Doc {
  hit: HitBase;
  tf: Map<string, number>;
  len: number;
}

function weighted(fields: [string, number][]): { tf: Map<string, number>; len: number } {
  const tf = new Map<string, number>();
  let len = 0;
  for (const [text, w] of fields) {
    for (const t of tokens(text)) {
      tf.set(t, (tf.get(t) ?? 0) + w);
      len += w;
    }
  }
  return { tf, len };
}

const DOCS: Doc[] = [
  ...ARTICLES.map((a) => ({
    hit: { kind: 'article' as const, id: a.id, article: a },
    ...weighted([[a.title, 3], [a.keywords.join(' '), 2.5], [a.summary, 1.5], [a.body, 1], [a.section, 1]]),
  })),
  ...GLOSSARY.map((t) => ({
    hit: { kind: 'term' as const, id: t.id, term: t },
    ...weighted([[t.term, 3], [t.aliases.join(' '), 2.5], [t.definition, 1]]),
  })),
];

const AVG = DOCS.reduce((a, d) => a + d.len, 0) / DOCS.length;
const DF = new Map<string, number>();
for (const d of DOCS) for (const t of d.tf.keys()) DF.set(t, (DF.get(t) ?? 0) + 1);

function idf(t: string): number {
  const n = DF.get(t) ?? 0;
  return Math.log(1 + (DOCS.length - n + 0.5) / (n + 0.5));
}

/** Expand a query with synonyms; original words count double. */
function expand(q: string): Map<string, number> {
  const out = new Map<string, number>();
  const raw = q.toLowerCase().replace(/[’']/g, '').split(/[^a-z0-9%]+/).filter(Boolean);
  for (const w of raw) {
    if (STOP.has(w)) continue;
    const s = stem(w);
    out.set(s, (out.get(s) ?? 0) + 2);
    for (const syn of SYNONYMS[w] ?? SYNONYMS[s] ?? []) {
      const ss = stem(syn);
      out.set(ss, Math.max(out.get(ss) ?? 0, 0.6));
    }
  }
  return out;
}

export function search(query: string, limit = 5): Hit[] {
  const q = expand(query);
  if (!q.size) return [];
  const k1 = 1.4;
  const b = 0.7;
  const phrase = query.toLowerCase().trim();

  const scored = DOCS.map((d) => {
    let score = 0;
    for (const [t, qw] of q) {
      const f = d.tf.get(t);
      if (!f) continue;
      score += qw * idf(t) * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / AVG)));
    }
    // Asking for a term by name ("what is cost per use") should find its definition.
    if (d.hit.kind === 'term') {
      const names = [d.hit.term.term, ...d.hit.term.aliases].map((n) => n.toLowerCase());
      if (names.some((n) => n.length > 2 && phrase.includes(n))) score *= 1.6;
    } else if (phrase.includes(d.hit.article.title.toLowerCase())) {
      score *= 1.5;
    }
    return { ...d.hit, score } as Hit;
  });

  return scored.filter((h) => h.score > 0.8).sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Articles to hand the AI as reference: the top articles plus those linked from top terms. */
export function referenceFor(query: string, maxArticles = 4): Article[] {
  const hits = search(query, 8);
  const ids: string[] = [];
  for (const h of hits) {
    const id = h.kind === 'article' ? h.id : h.term.article;
    if (id && !ids.includes(id)) ids.push(id);
  }
  if (!ids.length) ids.push('what-is-tally');
  return ids.slice(0, maxArticles).map((id) => ARTICLES.find((a) => a.id === id)!);
}
