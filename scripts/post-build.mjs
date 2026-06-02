// Stamps a per-format package.json into each emit dir so Node resolves
// `dist/esm/*.js` as ESM and `dist/cjs/*.js` as CommonJS, regardless of
// the parent package's "type" field. Copied verbatim from the OES
// published-package recipe (@overengineered-solutions/ui · observability).
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const writes = [
  ['esm', '{"type":"module"}\n'],
  ['cjs', '{"type":"commonjs"}\n'],
];
for (const [dir, body] of writes) {
  const target = join(root, 'dist', dir);
  if (!existsSync(target)) {
    console.error(`post-build: dist/${dir} missing — did the matching tsc step run?`);
    process.exit(1);
  }
  writeFileSync(join(target, 'package.json'), body);
}
