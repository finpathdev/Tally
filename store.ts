import { type AppState, demoState, migrate } from './lib/schema.ts';

const KEY = 'tally:v2';
const LEGACY_KEY = 'FINANCIAL_WELLNESS_HUB_DATA_V1';
const UNDO_LIMIT = 30;

type Listener = (state: AppState) => void;

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function load(): { state: AppState; source: 'saved' | 'legacy' | 'demo' } {
  for (const [key, source] of [[KEY, 'saved'], [LEGACY_KEY, 'legacy']] as const) {
    const raw = safeGet(key);
    if (!raw) continue;
    try {
      return { state: migrate(JSON.parse(raw)), source };
    } catch (e) {
      console.warn(`Ignoring unreadable data in ${key}`, e);
    }
  }
  return { state: demoState(), source: 'demo' };
}

/**
 * Single source of truth. Every change goes through `update`, which records
 * an undo snapshot, persists, and notifies views. Changes in another tab are
 * picked up through the `storage` event.
 */
class Store {
  state: AppState;
  readonly loadedFrom: 'saved' | 'legacy' | 'demo';
  private listeners = new Set<Listener>();
  private undoStack: { label: string; snapshot: AppState }[] = [];

  constructor() {
    const { state, source } = load();
    this.state = state;
    this.loadedFrom = source;
    // Save migrated or freshly generated sample data right away, so ids stay
    // stable across reloads (reminders and the what-if selection rely on them).
    if (source !== 'saved') this.persist();
    if (source === 'demo') {
      try { localStorage.setItem('tally:sample', '1'); } catch { /* ignore */ }
    }
    window.addEventListener('storage', (e) => {
      if (e.key !== KEY || !e.newValue) return;
      try {
        this.state = migrate(JSON.parse(e.newValue));
        this.emit();
      } catch {
        /* ignore partial writes */
      }
    });
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  update(label: string | null, mutate: (draft: AppState) => void) {
    if (label) {
      this.undoStack.push({ label, snapshot: structuredClone(this.state) });
      if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    }
    const draft = structuredClone(this.state);
    mutate(draft);
    this.state = draft;
    this.persist();
    this.emit();
  }

  /**
   * Save without re-rendering or recording undo. For text settings typed
   * into a form, where a re-render mid-typing would fight the cursor (or a
   * browser's autofill).
   */
  patch(mutate: (draft: AppState) => void) {
    mutate(this.state);
    this.persist();
  }

  replace(next: AppState, label = 'Replace data') {
    this.update(label, (d) => Object.assign(d, structuredClone(next)));
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  undo(): string | null {
    const last = this.undoStack.pop();
    if (!last) return null;
    this.state = last.snapshot;
    this.persist();
    this.emit();
    return last.label;
  }

  private persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.state));
    } catch {
      /* private mode or quota: keep working in memory */
    }
  }

  private emit() {
    this.listeners.forEach((fn) => fn(this.state));
  }
}

export const store = new Store();
