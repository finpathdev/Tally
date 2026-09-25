import { toast } from './dom.ts';

/**
 * Register the service worker and surface updates as a toast. A new version
 * installs in the background and only takes over when the person chooses
 * "Reload", so nothing changes under them mid-edit.
 */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;

  // Reload only when the person accepted an update. The first install also
  // fires controllerchange (clients.claim), and that must not reload the page.
  let accepted = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!accepted) return;
    accepted = false;
    location.reload();
  });

  const offer = (worker: ServiceWorker) =>
    toast('A new version of Tally is ready.', {
      label: 'Reload',
      run: () => {
        accepted = true;
        worker.postMessage('skip-waiting');
      },
    }, 30_000);

  navigator.serviceWorker
    .register(`${import.meta.env.BASE_URL}sw.js`)
    .then((reg) => {
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => {
          // "installed" with an existing controller means an update, not a first install.
          if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
          if (w.state === 'activated' && !navigator.serviceWorker.controller) {
            toast('Tally is ready to work offline.');
          }
        });
      });
      // Check for updates when the app comes back to the foreground.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    })
    .catch(() => {
      /* e.g. private mode; the app still works online */
    });
}

/** Number on the app icon (installed app only; ignored elsewhere). */
export function setBadge(count: number) {
  const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  try {
    if (count > 0) nav.setAppBadge?.(count)?.catch(() => {});
    else nav.clearAppBadge?.()?.catch(() => {});
  } catch {
    /* unsupported */
  }
}

type FileRouter = (file: File) => void;

/**
 * Files can arrive three ways: opened from the OS with the installed app
 * (File Handling API), dropped anywhere on the window, or picked in the UI.
 * The first two funnel through here.
 */
export function initFileIntake(route: FileRouter) {
  type LaunchParams = { files: readonly FileSystemFileHandle[] };
  const lq = (window as Window & { launchQueue?: { setConsumer(cb: (p: LaunchParams) => void): void } }).launchQueue;
  lq?.setConsumer(async (params) => {
    for (const handle of params.files) route(await handle.getFile());
  });

  let depth = 0;
  const overlay = document.createElement('div');
  overlay.className = 'drop-overlay';
  overlay.textContent = 'Drop a bank CSV to find subscriptions, or a Tally backup to restore it';
  overlay.hidden = true;
  document.body.appendChild(overlay);

  const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e) || (e.target as HTMLElement).closest?.('.dropzone')) return;
    depth++;
    overlay.hidden = false;
  });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) overlay.hidden = true;
  });
  window.addEventListener('dragover', (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e) || (e.target as HTMLElement).closest?.('.dropzone')) return;
    e.preventDefault();
    depth = 0;
    overlay.hidden = true;
    const file = e.dataTransfer?.files[0];
    if (file) route(file);
  });
}
