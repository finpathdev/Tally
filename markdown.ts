import { h } from '../ui/dom.ts';

/**
 * Minimal, safe Markdown → DOM for help articles and AI answers.
 * Supports paragraphs, ### headings, **bold**, *italic*, `code`,
 * "- " and "1. " lists (one level of nesting), and [links](href).
 *
 * Everything becomes text nodes or whitelisted elements; nothing is ever
 * parsed as HTML, so an AI answer can't inject markup or scripts. Links are
 * limited to in-app routes (#/…) and https URLs.
 */

function safeHref(href: string): string | null {
  if (/^#\/[\w/-]*$/.test(href)) return href;
  try {
    const u = new URL(href);
    return u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

/** Inline formatting. */
export function inline(text: string): Node[] {
  const out: Node[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|(?<![\w*])\*[^*\s][^*]*\*(?![\w*]))/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(document.createTextNode(text.slice(last, m.index)));
    const tok = m[0];
    if (tok.startsWith('**')) out.push(h('strong', null, ...inline(tok.slice(2, -2))));
    else if (tok.startsWith('`')) out.push(h('code', null, tok.slice(1, -1)));
    else if (tok.startsWith('[')) {
      const [, label, href] = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok)!;
      const safe = safeHref(href!);
      out.push(
        safe
          ? h('a', { href: safe, ...(safe.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {}) }, label!)
          : document.createTextNode(label!),
      );
    } else out.push(h('em', null, tok.slice(1, -1)));
    last = m.index! + tok.length;
  }
  if (last < text.length) out.push(document.createTextNode(text.slice(last)));
  return out;
}

export function renderMarkdown(src: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  let para: string[] = [];
  let list: { el: HTMLOListElement | HTMLUListElement; ordered: boolean } | null = null;
  let lastItem: HTMLLIElement | null = null;
  let sub: HTMLUListElement | HTMLOListElement | null = null;

  const flushPara = () => {
    if (para.length) frag.appendChild(h('p', null, ...inline(para.join(' '))));
    para = [];
  };
  const closeList = () => {
    list = null;
    lastItem = null;
    sub = null;
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    const bullet = /^(\s*)([-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (bullet) {
      flushPara();
      const [, indent, marker, text] = bullet;
      const ordered = /\d/.test(marker!);
      if (indent!.length >= 2 && lastItem) {
        if (!sub) {
          sub = ordered ? h('ol') : h('ul');
          lastItem.appendChild(sub);
        }
        sub.appendChild(h('li', null, ...inline(text!)));
        continue;
      }
      if (!list || list.ordered !== ordered) {
        list = { el: ordered ? h('ol') : h('ul'), ordered };
        frag.appendChild(list.el);
      }
      sub = null;
      lastItem = h('li', null, ...inline(text!));
      list.el.appendChild(lastItem);
      continue;
    }
    if (!line.trim()) {
      flushPara();
      closeList();
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      flushPara();
      closeList();
      frag.appendChild(h('p', { class: 'md-h' }, ...inline(heading[1]!)));
      continue;
    }
    if (list && /^\s{2,}\S/.test(raw) && lastItem) {
      // Continuation of a list item.
      lastItem.append(' ', ...inline(line.trim()));
      continue;
    }
    closeList();
    para.push(line.trim());
  }
  flushPara();
  return frag;
}
