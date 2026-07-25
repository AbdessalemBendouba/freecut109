# i18n

i18next + react-i18next, initialized in `src/i18n/index.ts` (imported once from `main.tsx`). 9 languages (`en`, `es`, `fr`, `de`, `pt-BR`, `tr`, `ja`, `ko`, `zh`) in `src/i18n/languages.ts`.

## Layout

- Base strings in `src/i18n/locales/<lang>.json`
- Per-feature strings in `src/i18n/locales/partials/<lang>/<name>.json` — the file contains the slice directly, with no language wrapper key
- `en` partials are eagerly bundled into `app-shell`; all other languages load on demand via `loadLanguageResources(lang)` / `changeAppLanguage(lang)` from `@/i18n`
- The user's persisted language is preloaded before first render via the exported `i18nReady` promise
- Language selector lives in the editor Settings dialog (General); persisted to `localStorage` key `freecut-language` by the language detector

## Usage

- In components: `const { t } = useTranslation()`
- Outside React: `import { i18n } from '@/i18n'` then `i18n.t()` — `@/i18n` is allowed by the boundary checks, it's not `@/features/*`
- Strings with inline markup: `<Trans i18nKey=... components={{ strong: <strong/> }} />`
- Resources are deliberately untyped (`i18next.d.ts`) so `t()` accepts any key

## When adding new partials

Translate all 9 languages and keep an identical key structure across all language dirs. Never put a bare ASCII `"` inside a JSON string value.
