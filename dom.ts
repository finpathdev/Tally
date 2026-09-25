import { ICONS, type IconName } from './icons.ts';

type Child = Node | string | number | false | null | undefined | Child[];
type Handler = (ev: never) => void;
type Props = Record<string, unknown> & {
  class?: string | (string | false | null | undefined)[];
  style?: Partial<CSSStyleDeclaration> | string;
  dataset?: Record<string, string>;
};

/**
 * Tiny element factory. Strings always become text nodes, so user data can
 * never be interpreted as HTML (the original used innerHTML with raw names).
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) applyProps(el, props);
  append(el, children);
  return el;
}

function applyProps(el: Element, props: Props) {
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') {
      el.setAttribute('class', Array.isArray(value) ? value.filter(Boolean).join(' ') : String(value));
    } else if (key === 'style') {
      if (typeof value === 'string') el.setAttribute('style', value);
      else {
        const style = (el as HTMLElement).style;
        for (const [k, v] of Object.entries(value)) {
          // setProperty handles CSS custom properties (--x); assignment does not.
          if (k.startsWith('--')) style.setProperty(k, String(v));
          else (style as unknown as Record<string, unknown>)[k] = v;
        }
      }
    } else if (key === 'dataset') {
      Object.assign((el as HTMLElement).dataset, value);
    } else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key in el && !key.includes('-') && key !== 'list' && key !== 'form') {
      (el as unknown as Record<string, unknown>)[key] = value;
    } else {
      el.setAttribute(key, value === true ? '' : String(value));
    }
  }
}

export function append(el: Node, children: Child[]) {
  for (const c of children.flat(Infinity as 1) as Child[]) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function svg(tag: string, attrs: Record<string, string | number> = {}, ...children: Node[]): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  children.forEach((c) => el.appendChild(c));
  return el;
}

export function icon(name: IconName, size = 18): SVGElement {
  const root = svg('svg', {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 1.75,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
    class: 'icon',
  });
  for (const [tag, attrs] of ICONS[name]) root.appendChild(svg(tag, attrs as Record<string, string | number>));
  return root;
}

export function button(
  label: Child,
  onClick: (ev: MouseEvent) => void,
  opts: { variant?: 'primary' | 'ghost' | 'danger' | 'quiet'; icon?: IconName; title?: string; small?: boolean; key?: string; type?: 'button' | 'submit' } = {},
): HTMLButtonElement {
  const iconOnly = label === '' && opts.icon;
  return h(
    'button',
    {
      type: opts.type ?? 'button',
      class: ['btn', `btn-${opts.variant ?? 'ghost'}`, opts.small && 'btn-sm', iconOnly && 'btn-icon'],
      title: opts.title,
      'aria-label': iconOnly ? opts.title : undefined,
      dataset: opts.key ? { key: opts.key } : undefined,
      onClick,
    },
    opts.icon ? icon(opts.icon, opts.small ? 15 : 17) : null,
    iconOnly ? null : h('span', null, label),
  );
}

let fieldSeq = 0;

/**
 * Labelled form field. The label is linked with for/id (not wrapped around
 * the control), so a <select>'s accessible name is just its label rather than
 * the label plus every option. Hints are linked with aria-describedby.
 */
export function field(label: string, control: HTMLElement, hint?: string): HTMLDivElement {
  const id = control.id || `f${++fieldSeq}`;
  control.id = id;
  const hintId = hint ? `${id}-hint` : undefined;
  if (hintId) control.setAttribute('aria-describedby', hintId);
  return h(
    'div',
    { class: 'field' },
    h('label', { class: 'field-label', htmlFor: id }, label),
    control,
    hint ? h('span', { class: 'field-hint', id: hintId }, hint) : null,
  );
}

export function empty(title: string, body: string, action?: HTMLElement): HTMLElement {
  return h('div', { class: 'empty' }, h('p', { class: 'empty-title' }, title), h('p', null, body), action ?? null);
}

// ---------- toasts ----------

let toastHost: HTMLElement | null = null;

export function toast(message: string, action?: { label: string; run: () => void }, ms = 5000) {
  toastHost ??= document.getElementById('toasts');
  if (!toastHost) return;
  const el = h('div', { class: 'toast', role: 'status' }, h('span', null, message));
  let timer = 0;
  const close = () => {
    clearTimeout(timer);
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 180);
  };
  if (action) {
    el.appendChild(
      button(action.label, () => {
        action.run();
        close();
      }, { variant: 'quiet', small: true }),
    );
  }
  toastHost.appendChild(el);
  timer = window.setTimeout(close, ms);
}

// ---------- dialogs ----------

/**
 * Open a native <dialog> with a form. `onSubmit` returns an error string to
 * keep the dialog open and show the message, or nothing to close it.
 */
export function openDialog(opts: {
  title: string;
  body: (form: HTMLFormElement) => Child;
  submitLabel: string;
  onSubmit: (data: FormData, form: HTMLFormElement) => string | void | Promise<string | void>;
  extraActions?: HTMLElement[];
  /** Information only: show just the submit button, no Cancel. */
  infoOnly?: boolean;
}): HTMLDialogElement {
  const error = h('p', { class: 'form-error', role: 'alert' });
  const form: HTMLFormElement = h('form', { method: 'dialog', class: 'dialog-form', noValidate: false });
  const dialog = h(
    'dialog',
    { class: 'dialog', 'aria-labelledby': 'dialog-title' },
    form,
  );
  append(form, [
    h(
      'header',
      { class: 'dialog-head' },
      h('h2', { id: 'dialog-title' }, opts.title),
      button('', () => dialog.close(), { icon: 'x', title: 'Close', variant: 'quiet' }),
    ),
    h('div', { class: 'dialog-body' }, opts.body(form)),
    error,
    h(
      'footer',
      { class: 'dialog-foot' },
      ...(opts.extraActions ?? []),
      h('span', { class: 'spacer' }),
      opts.infoOnly ? null : button('Cancel', () => dialog.close(), { variant: 'ghost' }),
      button(opts.submitLabel, () => {}, { variant: 'primary', type: 'submit' }),
    ),
  ]);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const result = await opts.onSubmit(new FormData(form), form);
    if (typeof result === 'string') {
      error.textContent = result;
    } else {
      dialog.close();
    }
  });
  // Views re-render on save, so the button that opened the dialog may have
  // been replaced. Return focus to its successor via data-key.
  const opener = document.activeElement as HTMLElement | null;
  const openerKey = opener?.dataset?.key;
  dialog.addEventListener('close', () => {
    dialog.remove();
    const target = opener?.isConnected ? opener : openerKey ? document.querySelector<HTMLElement>(`[data-key="${CSS.escape(openerKey)}"]`) : null;
    target?.focus();
  });
  document.body.appendChild(dialog);
  dialog.showModal();
  (form.querySelector('input, select, textarea') as HTMLElement | null)?.focus();
  return dialog;
}

export function confirmDialog(title: string, body: string, confirmLabel: string): Promise<boolean> {
  return new Promise((resolve) => {
    let ok = false;
    const d = openDialog({
      title,
      body: () => h('p', null, body),
      submitLabel: confirmLabel,
      onSubmit: () => {
        ok = true;
      },
    });
    d.addEventListener('close', () => resolve(ok));
  });
}

export async function copyText(text: string, done = 'Copied to clipboard') {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch {
    toast('Copy failed. Your browser blocked clipboard access.');
  }
}

export function download(filename: string, content: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = h('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Segmented control (radio group styled as tabs). */
export function segmented<T extends string>(
  name: string,
  options: { value: T; label: string; icon?: IconName }[],
  current: T,
  onChange: (v: T) => void,
): HTMLElement {
  return h(
    'div',
    { class: 'segmented', role: 'radiogroup', 'aria-label': name },
    options.map((o) =>
      h(
        'button',
        {
          type: 'button',
          role: 'radio',
          'aria-checked': String(o.value === current),
          class: o.value === current ? 'on' : '',
          dataset: { key: `${name}-${o.value}` },
          onClick: () => onChange(o.value),
        },
        o.icon ? icon(o.icon, 15) : null,
        o.label,
      ),
    ),
  );
}
