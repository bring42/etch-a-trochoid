# etch-a-trochoid

A spirograph playground that prints. Land on the page, see a trochoid pattern drawing itself, drag a slider, and discover that the pattern is being made by *real meshing involute gears* — and that those gears can be exported as a paper kit or as STL files for a 3D printer.

## What's in it

- **Spirograph mode** (the landing page) — big canvas dominates the screen. Three sliders: big gear, small gear, pen position. Six named presets. A `Show gears →` button reveals the involute mechanism actually doing the drawing. An `Export` button opens a popup with three offerings:
  - the **Drawing** as an SVG,
  - a **Paper kit** (ring + planet on A4 with all pen-hole positions marked, scale 1:1),
  - a **3D printable kit** — two STL files (ring/sun and planet) with pen holes baked in as through-holes, watertight and manifold.
- **Advanced** drawer — module, bore, pen-hole count, phase, animation speed, 3D thickness, and 3D clearance. Hidden by default.
- **Gear Designer** mode (linked from a small "Build a custom gear →" link) — full involute parameter control: teeth, module, pressure angle, profile shift, addendum/dedendum coefficients, bore. Live mm-grid preview with pitch / base / tip / root reference circles. Exports SVG or STL.

The trochoid math is real (hypotrochoid + epitrochoid), the gear math is real (involute with proper base / pitch / tip / root geometry), and the STL output is real (watertight, manifold, mm units, with configurable backlash / axle clearance).

## Stack

- React 19
- TypeScript
- Vite 6
- Tailwind CSS v4 via `@tailwindcss/vite`
- [earcut](https://github.com/mapbox/earcut) for cap-face triangulation around pen holes
- Cloudflare Wrangler static-asset deployment

## Local development

```bash
npm install
npm run dev
```

Self-tests for the gear math run automatically on page load and log results to the browser console.

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

## Files

- [src/gear-math.ts](src/gear-math.ts) — involute geometry (external + internal), mesh check, hypotrochoid + epitrochoid math, pen-hole layout, self-tests.
- [src/svg-export.ts](src/svg-export.ts) — single-gear SVG and spirograph-kit SVG exports, all in millimeters.
- [src/stl-export.ts](src/stl-export.ts) — watertight 3D mesh + binary STL writer with clearance and pen-hole through-holes.
- [src/App.tsx](src/App.tsx) — UI: spirograph playground, gear designer, export popup.
- [src/main.tsx](src/main.tsx) / [src/style.css](src/style.css) — entry and Tailwind import.
