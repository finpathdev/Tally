import { formatMoney } from '../lib/money.ts';
import type { AppState } from '../lib/schema.ts';
import { store } from '../store.ts';

export type Tab = 'subscriptions' | 'split' | 'cart' | 'sync' | 'help';

export interface ViewContext {
  state: AppState;
  today: string;
  money: (minor: number, currency?: string) => string;
  rerender: () => void;
  go: (tab: Tab) => void;
}

export function makeContext(today: string, rerender: () => void, go: (t: Tab) => void): ViewContext {
  const state = store.state;
  return {
    state,
    today,
    money: (m, c = state.settings.currency) => formatMoney(m, c),
    rerender,
    go,
  };
}
