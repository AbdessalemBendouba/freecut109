# lottie-browser/deps

Cross-feature adapters for the Lottie browser panel. Per the repo boundary
rules, any import from another `src/features/*` module must live in a
`*-contract.ts` file here; the plain adapter (`x.ts`) only re-exports it.

- `media-library-contract.ts` / `media-library.ts` — the media-library store,
  used to run `importRemoteLottie` when the user adds an animation.
