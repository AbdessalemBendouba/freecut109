import { defineConfig, lazyPlugins } from 'vite-plus'
import type { Plugin } from 'vite-plus'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Stamps public/sw.js with the hashed entry-chunk filename at build time so the service
// worker's CACHE_VERSION — and the sw.js bytes — change on every deploy.
function serviceWorkerVersionPlugin(): Plugin {
  const placeholder = '__FREECUT_BUILD_ID__'
  let buildId = ''

  return {
    name: 'freecut-sw-version',
    apply: 'build',
    writeBundle(options, bundle) {
      const mainEntry = Object.values(bundle).find(
        (output) => output.type === 'chunk' && output.isEntry && output.name === 'main',
      )
      buildId =
        mainEntry && mainEntry.type === 'chunk'
          ? mainEntry.fileName.replace(/[^a-zA-Z0-9]/g, '-')
          : buildId
    },
    closeBundle() {
      if (!buildId) {
        this.warn('serviceWorkerVersionPlugin: no main entry chunk found; sw.js not stamped')
        return
      }
      const swPath = join(fileURLToPath(new URL('./dist', import.meta.url)), 'sw.js')
      const source = readFileSync(swPath, 'utf8')
      if (!source.includes(placeholder)) {
        return
      }
      writeFileSync(swPath, source.replaceAll(placeholder, buildId))
    },
  }
}

const oxlintConfig = JSON.parse(readFileSync(new URL('./.oxlintrc.json', import.meta.url), 'utf8'))
const oxfmtConfig = JSON.parse(readFileSync(new URL('./.oxfmtrc.json', import.meta.url), 'utf8'))
const toolIgnorePatterns = [
  'dist/**',
  'coverage/**',
  'public/**',
  'tmp/**',
  'output/**',
  'scripts/**',
]

// https://vite.dev/config/
export default defineConfig({
  // Dynamic base URL for GitHub Pages (/freecut109/) or local dev (/)
  base: process.env.VITE_BASE_URL || '/',
  lint: {
    ...oxlintConfig,
    ignorePatterns: toolIgnorePatterns,
    options: {
      ...(oxlintConfig.options ?? {}),
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {
    ignorePatterns: [...toolIgnorePatterns, 'src/routeTree.gen.ts'],
  },
  staged: {
    '*.{js,ts,tsx,json}': 'vp check --fix',
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      thresholds: {
        statements: 48,
        branches: 42,
        functions: 52,
        lines: 49,
      },
    },
  },
  plugins: lazyPlugins(() => [react(), tailwindcss(), serviceWorkerVersionPlugin()]),
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
    dedupe: ['react', 'react-dom'],
  },
  server: {
    port: 5173,
    strictPort: true,
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Document-Policy': 'js-profiling',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },
  build: {
    // Target Chromium 109 / ES2020 for Windows 7 browser compatibility
    target: ['chrome109', 'es2020'],
    sourcemap: true,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        headless: fileURLToPath(new URL('./headless.html', import.meta.url)),
      },
      output: {
        manualChunks: (id) => {
          const normalizedId = id.replaceAll('\\', '/')
          const isWorkspaceGateShell =
            normalizedId.endsWith('/src/features/workspace-gate/workspace-gate.tsx') ||
            normalizedId.endsWith('/src/features/workspace-gate/workspace-gate-splash.tsx') ||
            normalizedId.endsWith('/src/features/workspace-gate/use-pathname.ts')
          const isAppShellComponent =
            normalizedId.endsWith('/src/components/brand/freecut-logo.tsx') ||
            normalizedId.endsWith('/src/components/ui/accordion.tsx') ||
            normalizedId.endsWith('/src/components/ui/button.tsx') ||
            normalizedId.endsWith('/src/components/ui/button-variants.ts') ||
            normalizedId.endsWith('/src/components/ui/global-tooltip.tsx')

          if (id.endsWith('src/shared/logging/logger.ts')) {
            return 'core-logger'
          }

          if (
            isAppShellComponent ||
            (normalizedId.includes('/src/routes/') && !normalizedId.includes('.lazy.')) ||
            normalizedId.includes('/src/app/error-boundary') ||
            normalizedId.includes('/src/app/pwa-install-prompt') ||
            isWorkspaceGateShell ||
            (normalizedId.includes('/src/i18n/') &&
              !normalizedId.includes('/src/i18n/locales/partials/'))
          ) {
            return 'app-shell'
          }

          if (
            id.includes('/src/features/timeline/contracts/editor.ts') ||
            id.includes('/src/features/timeline/index.ts')
          ) {
            return 'feature-editing-ui'
          }

          if (normalizedId.includes('/src/infrastructure/gpu-effects/')) {
            return 'gpu-effects'
          }
          if (
            normalizedId.includes('/src/features/media-library/services/media-library-service') ||
            normalizedId.includes('/src/features/media-library/services/file-access')
          ) {
            return 'media-library-service'
          }
          if (
            normalizedId.includes('/src/features/media-library/services/media-analysis-service') ||
            normalizedId.includes('/src/features/media-library/deps/analysis')
          ) {
            return 'media-analysis'
          }
          if (
            normalizedId.includes('/src/features/timeline/components/clip-filmstrip') ||
            normalizedId.includes('/src/features/timeline/components/clip-waveform') ||
            normalizedId.includes('/src/features/timeline/hooks/use-filmstrip') ||
            normalizedId.includes('/src/features/timeline/hooks/use-gif-frames') ||
            normalizedId.includes('/src/features/timeline/hooks/use-waveform') ||
            normalizedId.includes('/src/features/timeline/services/filmstrip-cache') ||
            normalizedId.includes('/src/features/timeline/services/filmstrip-storage') ||
            normalizedId.includes('/src/features/timeline/services/waveform-cache') ||
            normalizedId.includes('/src/features/timeline/services/waveform-opfs-storage') ||
            normalizedId.includes('/src/features/timeline/services/gif-frame-cache') ||
            normalizedId.includes('/src/features/timeline/utils/compound-clip-waveform')
          ) {
            return 'timeline-media-visuals'
          }
          if (
            normalizedId.includes('/src/features/timeline/components/keyframe-graph-panel') ||
            normalizedId.includes('/src/features/timeline/deps/keyframe-editors') ||
            normalizedId.includes('/src/features/keyframes/components/dopesheet-editor') ||
            normalizedId.includes('/src/features/keyframes/components/value-graph-editor')
          ) {
            return 'timeline-keyframe-graph'
          }
          if (
            id.includes('/src/features/timeline/components/bento-layout-dialog') ||
            id.includes('/src/features/timeline/components/reverse-conform-dialog') ||
            id.includes('/src/features/timeline/components/silence-removal-dialog') ||
            id.includes('/src/features/timeline/components/filler-removal-dialog')
          ) {
            return 'timeline-dialogs'
          }
          if (
            id.includes('/src/features/timeline/') ||
            id.includes('/src/features/media-library/')
          ) {
            if (id.includes('/components/')) {
              return 'feature-editing-ui'
            }
            return 'feature-editing-core'
          }
          if (id.includes('/src/features/effects/')) {
            return 'feature-effects'
          }
          if (id.includes('/src/features/composition-runtime/')) {
            return 'feature-editing-core'
          }

          if (id.includes('node_modules/react-dom')) {
            return 'react-vendor'
          }
          if (id.includes('node_modules/react/')) {
            return 'react-vendor'
          }
          if (id.includes('@tanstack/react-router')) {
            return 'router-vendor'
          }
          if (normalizedId.includes('sonner')) {
            return 'toast-vendor'
          }
          if (id.includes('/node_modules/zustand/') || id.includes('/node_modules/zundo/')) {
            return 'state-vendor'
          }
          if (id.includes('@mediabunny/ac3')) {
            return 'media-ac3-decoder'
          }
          if (id.includes('@mediabunny/mp3-encoder')) {
            return 'media-mp3-encoder'
          }
          if (id.includes('/node_modules/mediabunny/')) {
            return 'media-bunny-core'
          }
          if (id.includes('@mediabunny/')) {
            return 'media-processing'
          }
          if (id.includes('/node_modules/gifuct-js/')) {
            return 'gif-processing'
          }
          if (id.includes('@radix-ui/')) {
            return 'vendor-ui'
          }
          if (id.includes('lucide-react')) {
            return 'vendor-icons'
          }
          if (
            normalizedId.includes('/node_modules/motion/') ||
            normalizedId.includes('/node_modules/framer-motion/')
          ) {
            return 'vendor-motion'
          }
          return undefined
        },
      },
    },
  },
  worker: {
    format: 'es',
    rollupOptions: {
      output: {
        target: ['chrome109', 'es2020'],
      },
    },
  },
  optimizeDeps: {
    exclude: [
      'mediabunny',
      '@mediabunny/ac3',
      '@mediabunny/mp3-encoder',
      '@mediabunny/aac-encoder',
      '@huggingface/transformers',
    ],
    include: [
      'react',
      'react-dom',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
      '@radix-ui/react-tooltip',
      'lucide-react',
    ],
  },
})
