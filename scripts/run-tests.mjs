// Bundles the TypeScript test file through Vite (so the extensionless imports
// used across src/ resolve) and runs the result on Node.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

const outDir = await mkdtemp(join(tmpdir(), 'agf-test-'));

try {
  await build({
    configFile: false,
    logLevel: 'warn',
    build: {
      ssr: 'test/logic.test.ts',
      outDir,
      emptyOutDir: false,
      minify: false,
      target: 'node20',
      rollupOptions: { output: { entryFileNames: 'logic.test.mjs', format: 'es' } }
    }
  });

  await import(pathToFileURL(join(outDir, 'logic.test.mjs')).href);
} finally {
  await rm(outDir, { recursive: true, force: true });
}
