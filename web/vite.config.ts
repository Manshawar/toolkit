import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

/** SPA → ../assets/ui（随包发布，供 tkt ui 托管） */
export default defineConfig({
  plugins: [preact(), tailwindcss()],
  resolve: {
    alias: {
      '@web': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        configure(proxy) {
          proxy.on('error', (_err, _req, res) => {
            const r = res as { writeHead?: Function; end?: Function; headersSent?: boolean }
            if (r.writeHead && !r.headersSent) {
              r.writeHead(502, { 'Content-Type': 'application/json' })
              r.end?.(
                JSON.stringify({
                  error: 'API :8787 未响应，请确认 pnpm ui:dev 的 [api] 进程在跑',
                }),
              )
            }
          })
        },
      },
    },
  },
  build: {
    outDir: resolve(__dirname, '../assets/ui'),
    emptyOutDir: true,
    sourcemap: true,
  },
})
