# WebP Converter

Convert JPG, PNG, GIF, BMP, AVIF and SVG images to WebP entirely in the browser. Files are never uploaded.

Built on [eleventy-njk-tailwind-template](https://github.com/rdmarkanthony/eleventy-njk-tailwind-template) (Eleventy + Nunjucks + Tailwind v4 + esbuild).

## Features

- Drag & drop, file picker, or paste from clipboard; batch conversion
- Quality slider and optional max width / height (aspect ratio kept)
- Per-file size comparison, single download, or download all as a ZIP
- Conversion uses the browser's native canvas WebP encoder (Chrome, Edge, Firefox). Safari and every iOS browser can't encode WebP, so they fall back to libwebp compiled to WebAssembly ([@jsquash/webp](https://github.com/jamsinclair/jSquash)), served from `/assets/wasm/` and only downloaded when needed

## Usage

Requires Node.js 18+ and pnpm 10+.

```bash
pnpm install
pnpm dev     # dev server with watch
pnpm build   # production build to public/
```

`public/` is a static site and can be deployed to any static host.

## Source

- `src/index.njk` — page markup
- `src/assets/js/utils/_webp-converter.js` — decode, encode (canvas or wasm), zip helpers
- `src/assets/js/utils/_converter-ui.js` — drop zone, settings, results list
