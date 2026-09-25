import { svg } from './dom.ts';

export interface Ring {
  label: string;
  /** Relative weight (e.g. monthly cost). */
  weight: number;
  /** Lobes around the ring; encodes billing frequency. */
  lobes: number;
  tone: 'ink' | 'alert' | 'muted';
}

/**
 * A guilloché rosette, the engraved pattern printed on banknotes, drawn
 * from real data: one woven ring per subscription, from the cheapest inside
 * to the most expensive outside. A ring's swell shows its share of spending
 * and its lobe count shows how often it bills.
 */
export function rosette(rings: Ring[], size = 220): SVGElement {
  const c = 100;
  const root = svg('svg', {
    viewBox: '0 0 200 200',
    width: size,
    height: size,
    class: 'rosette',
    role: 'img',
    'aria-label': rings.length
      ? `Pattern of ${rings.length} subscriptions; larger swells cost more.`
      : 'Empty pattern: no subscriptions yet.',
  });

  // Base engraving so an empty state still looks intentional.
  root.appendChild(svg('circle', { cx: c, cy: c, r: 96, class: 'ros-frame' }));
  root.appendChild(svg('circle', { cx: c, cy: c, r: 12, class: 'ros-frame' }));

  const total = rings.reduce((a, r) => a + r.weight, 0) || 1;
  const sorted = [...rings].sort((a, b) => a.weight - b.weight);
  const inner = 20;
  const outer = 86;
  const step = sorted.length > 1 ? (outer - inner) / (sorted.length - 1) : 0;

  sorted.forEach((ring, i) => {
    const base = sorted.length > 1 ? inner + step * i : (inner + outer) / 2;
    const amp = 2 + 10 * Math.sqrt(ring.weight / total);
    const g = svg('g', { class: `ros-ring ros-${ring.tone}`, style: `--i:${i}` });
    const title = svg('title');
    title.textContent = ring.label;
    g.appendChild(title);
    // Three phase-shifted strands give the woven, engraved look.
    for (let strand = 0; strand < 3; strand++) {
      const phase = (strand * Math.PI * 2) / (3 * ring.lobes);
      let d = '';
      const N = 360;
      for (let k = 0; k <= N; k++) {
        const t = (k / N) * Math.PI * 2;
        const r = base + amp * Math.sin(ring.lobes * t + phase) + (amp / 3) * Math.sin(2 * ring.lobes * t);
        const x = c + r * Math.cos(t);
        const y = c + r * Math.sin(t);
        d += `${k ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`;
      }
      g.appendChild(svg('path', { d: d + 'Z' }));
    }
    root.appendChild(g);
  });
  return root;
}
