import { defineConfig } from 'tsup'
import { join } from 'path'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8'))

export default defineConfig({
  entry: ['src/index.ts'],
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: true,
  format: ['esm'],
  outDir: 'lib',
  define: {
    'process.env.PKG_NAME': JSON.stringify(pkg.name),
    'process.env.PKG_VERSION': JSON.stringify(pkg.version),
  },
  bundle: true,
  external: [
    'fs',
    'path',
    'os',
    'url',
    'util',
    'crypto',
    'stream',
    'events',
    'buffer',
    'process',
    'clipboardy',
  ],
  treeshake: true,
})
