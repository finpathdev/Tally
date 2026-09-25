import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * After the build, write the list of every output file into dist/sw.js and
 * stamp it with a content hash. The service worker precaches exactly what
 * shipped, and any change to the app produces a new worker (and an update
 * prompt) automatically.
 */
function precache(): Plugin {
  let outDir = 'dist';
  return {
    name: 'tally-precache',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const full = join(dir, name);
          if (statSync(full).isDirectory()) walk(full);
          else files.push(relative(outDir, full).split('\\').join('/'));
        }
      };
      walk(outDir);
      const list = files
        .filter((f) => f !== 'sw.js' && !f.endsWith('.map') && !f.startsWith('screenshots/') && !f.endsWith('.woff'))
        .sort();
      const hash = createHash('sha256');
      for (const f of list) hash.update(f).update(readFileSync(join(outDir, f)));
      const swPath = join(outDir, 'sw.js');
      const sw = readFileSync(swPath, 'utf8')
        .replace('__TALLY_VERSION__', hash.digest('hex').slice(0, 12))
        .replace('/*__TALLY_PRECACHE__*/ []', JSON.stringify(list.map((f) => `./${f}`)));
      writeFileSync(swPath, sw);
    },
  };
}

// `base` is set from the environment in the Pages workflow so the app works at
// https://<user>.github.io/<repo>/ as well as at the root during local dev.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [precache()],
  build: { target: 'es2022', sourcemap: true },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    coverage: { include: ['src/lib/**'], reporter: ['text', 'html'] },
  },
});
