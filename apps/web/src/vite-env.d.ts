/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** '1' builds the GitHub Pages demo on mock data. */
  readonly VITE_DEMO?: string
  /** 'brand' when the company icons were generated (vite.config.ts), else 'icons'. */
  readonly VITE_ICON_DIR?: string
}
