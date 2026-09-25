import { button, h, icon, openDialog, toast } from './dom.ts';

/**
 * "Install app" support across browsers:
 * - Chrome, Edge, Samsung Internet, Opera, Android: the native prompt, captured
 *   from `beforeinstallprompt` and fired from our own button.
 * - iPhone / iPad (any browser) and Safari on macOS: no prompt API exists, so
 *   the button opens short, platform-specific steps instead.
 * - Already installed (running standalone): the button is hidden.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type Platform = 'prompt' | 'ios' | 'mac-safari' | 'other';

let deferred: BeforeInstallPromptEvent | null = null;
/** Embedded previews (e.g. a hosted demo in an iframe) can't be installed. */
const EMBEDDED = import.meta.env.VITE_DEMO === '1' || window.self !== window.top;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: window-controls-overlay)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function platform(): Platform {
  if (deferred) return 'prompt';
  const ua = navigator.userAgent;
  const iOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (iOS) return 'ios';
  const safari = /Safari\//.test(ua) && !/Chrome|Chromium|Edg|OPR|Firefox/.test(ua);
  if (/Macintosh/.test(ua) && safari) return 'mac-safari';
  return 'other';
}

/** Whether our Install button has something useful to do in this browser. */
export function canOfferInstall(): boolean {
  return !EMBEDDED && !isStandalone() && platform() !== 'other';
}

export function onInstallChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function initInstall() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // keep the mini-infobar away; we show our own button
    deferred = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    toast('Tally is installed. Open it from your home screen, dock or app list.');
    notify();
  });
  window.matchMedia('(display-mode: standalone)').addEventListener('change', notify);
}

export async function install() {
  const p = platform();
  if (p === 'prompt' && deferred) {
    const ev = deferred;
    deferred = null; // a prompt can only be used once
    await ev.prompt();
    const { outcome } = await ev.userChoice;
    if (outcome === 'dismissed') toast('No problem. The Install button stays in the Sync tab if you change your mind.');
    notify();
    return;
  }
  showInstructions(p);
}

function step(n: number, ...content: (Node | string)[]) {
  return h('li', null, h('span', { class: 'inst-n', 'aria-hidden': 'true' }, String(n)), h('span', null, ...content));
}

function shareGlyph() {
  // The iOS share icon: a box with an up arrow.
  return h('span', { class: 'inst-glyph', 'aria-label': 'Share' }, icon('upload', 15));
}

export function showInstructions(p: Platform = platform()) {
  const body = () => {
    if (p === 'ios') {
      return h(
        'div',
        { class: 'install-steps' },
        h('p', null, 'On iPhone and iPad, apps are added from the Share menu.'),
        h('ol', null,
          step(1, 'Tap ', shareGlyph(), ' Share. In Safari it’s in the toolbar; in Chrome it’s at the top right.'),
          step(2, 'Scroll down and tap ', h('strong', null, 'Add to Home Screen'), '.'),
          step(3, 'If you see ', h('strong', null, 'Open as Web App'), ', leave it on. Then tap ', h('strong', null, 'Add'), '.'),
        ),
        h('p', { class: 'hint' }, 'Tally then opens full screen from its own icon and works offline.'),
      );
    }
    if (p === 'mac-safari') {
      return h(
        'div',
        { class: 'install-steps' },
        h('ol', null,
          step(1, 'In the menu bar, choose ', h('strong', null, 'File → Add to Dock…'), '.'),
          step(2, 'Click ', h('strong', null, 'Add'), '.'),
        ),
        h('p', { class: 'hint' }, 'Tally then opens in its own window from the Dock and works offline.'),
      );
    }
    return h(
      'div',
      { class: 'install-steps' },
      h('p', null, 'This browser doesn’t offer to install web apps directly. You have two options:'),
      h('ol', null,
        step(1, 'Open Tally in ', h('strong', null, 'Chrome'), ', ', h('strong', null, 'Edge'), ' or ', h('strong', null, 'Safari'), ' and use the Install button there.'),
        step(2, 'Or bookmark this page. Everything still works offline once it has loaded.'),
      ),
      h('p', { class: 'hint' }, 'In Chrome or Edge you can also use the install icon at the right end of the address bar.'),
    );
  };
  openDialog({ title: 'Install Tally', body, submitLabel: 'Got it', onSubmit: () => {}, infoOnly: true });
}

/** A card for the Sync tab: always explains, even where the top-bar button is hidden. */
export function installCard(): HTMLElement {
  if (EMBEDDED) {
    return h('div', { class: 'card install-card' },
      h('div', { class: 'install-art', 'aria-hidden': 'true' }, icon('download', 28)),
      h('div', null, h('h3', null, 'Use Tally as an app'),
        h('p', { class: 'hint' }, 'This is an embedded preview, so it can’t be installed from here. Open the deployed site (for example, your GitHub Pages address) and use Install app there.')));
  }
  const standalone = isStandalone();
  return h(
    'div',
    { class: 'card install-card' },
    h('div', { class: 'install-art', 'aria-hidden': 'true' }, h('img', { src: `${import.meta.env.BASE_URL}icon-192.png`, alt: '', width: 56, height: 56 })),
    h(
      'div',
      null,
      h('h3', null, standalone ? 'You’re using the app' : 'Use Tally as an app'),
      h(
        'p',
        { class: 'hint' },
        standalone
          ? 'Tally is installed on this device. It opens from its own icon, works offline, and shows a badge for renewals due in the next 3 days.'
          : 'Install it to open Tally from your home screen or dock, use it offline, open bank CSVs with it, and see a badge when renewals are due.',
      ),
    ),
    standalone
      ? null
      : button(deferred ? 'Install' : 'How to install', () => void install(), { variant: 'primary', icon: 'download', key: 'install-card' }),
  );
}
