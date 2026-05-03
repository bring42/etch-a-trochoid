# etch-a-trochoid

Etch-a-Trochoid is a Vite + React + TypeScript web app for exploring trochoid drawings with ring and gear ratio controls, pen offset tuning, inside/outside motion, optional mechanism overlays, and SVG export for both artwork and gear/ring fabrication layouts.

## Stack

- React
- TypeScript
- Vite
- Tailwind CSS via `@tailwindcss/vite`
- Cloudflare Wrangler static asset deployment

## Local development

```bash
npm run dev
```

## Production build

```bash
npm run build
```

## Cloudflare deploy

```bash
npm run deploy
```

## Expected Cloudflare settings

- Install command: `npm install`
- Build command: `npm run build`
- Output directory: `dist`
- Production branch: your chosen default branch
- SPA fallback: handled by `wrangler.jsonc` with `assets.not_found_handling: "single-page-application"`

## Notes

- The app entrypoint is `src/main.tsx` and the primary UI lives in `src/App.tsx`.
- Shared trochoid/export/validation geometry lives in `src/spirographGeometry.ts`.
- Tailwind is loaded from `src/style.css` with `@import "tailwindcss";`.
- Wrangler is configured to deploy the built static assets from `dist`.

## Feasibility + export notes

- The app now uses `matter-js` to do a lightweight plausibility pass on the selected ring/gear pairing.
- The status badge is intentionally subtle: it is a quick viability signal, not a manufacturing guarantee.
- `Export drawing` creates an actual-scale trace SVG based on the selected setup.
- `Export gear/ring` creates a fabrication-oriented SVG with gear geometry, hole positions, pitch references, and a short plausibility note.
- If you are cutting parts in real material, expect to tune kerf, material thickness, and fit after export.
