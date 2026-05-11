// Print-ready SVG export. Output uses mm units so default printing scale is 1:1.

import { type GearGeometry, type Point, planetPenHolePositions, pointsToPath, polar } from "./gear-math";

const STROKE_MM = 0.2; // ~ thinnest reliable laser-cut line; visible on print

function svgHeader(widthMm: number, heightMm: number): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${widthMm}mm" height="${heightMm}mm" viewBox="0 0 ${widthMm} ${heightMm}">
  <rect width="${widthMm}" height="${heightMm}" fill="white"/>
`;
}

function svgFooter(): string {
  return "</svg>\n";
}

function gearShapeSvg(geom: GearGeometry, cx: number, cy: number, label?: string): string {
  const profilePath = pointsToPath(
    geom.outerProfile.map((p) => ({ x: p.x + cx, y: p.y + cy })),
    true,
  );
  const parts: string[] = [];
  parts.push(`<g fill="none" stroke="black" stroke-width="${STROKE_MM}">`);

  if (geom.rimCircleRadius !== null) {
    // Internal gear: solid annulus with inner cutout = the involute profile.
    parts.push(
      `<circle cx="${cx}" cy="${cy}" r="${geom.rimCircleRadius.toFixed(4)}"/>`,
    );
  }

  parts.push(`<path d="${profilePath}"/>`);

  if (geom.params.boreDiameter > 0) {
    const r = geom.params.boreDiameter / 2;
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${r.toFixed(4)}"/>`);
    // Crosshair
    const t = Math.max(1, geom.pitchRadius * 0.05);
    parts.push(`<line x1="${cx - t}" y1="${cy}" x2="${cx + t}" y2="${cy}" stroke-width="${STROKE_MM / 2}"/>`);
    parts.push(`<line x1="${cx}" y1="${cy - t}" x2="${cx}" y2="${cy + t}" stroke-width="${STROKE_MM / 2}"/>`);
  }

  parts.push("</g>");

  if (label) {
    parts.push(
      `<g font-family="monospace" font-size="3" fill="black"><text x="${cx}" y="${cy + (geom.rimRadius + 5)}" text-anchor="middle">${escapeXml(label)}</text></g>`,
    );
  }

  return parts.join("\n");
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case "'":
        return "&apos;";
      case '"':
        return "&quot;";
      default:
        return c;
    }
  });
}

export function exportSingleGearSvg(geom: GearGeometry): string {
  const margin = 5;
  const size = geom.rimRadius * 2 + margin * 2;
  const cx = size / 2;
  const cy = size / 2;
  const label = `${geom.params.kind === "internal" ? "RING" : "GEAR"} z=${geom.params.teeth} m=${geom.params.module}mm  pd=${(geom.pitchRadius * 2).toFixed(2)}mm`;
  return svgHeader(size, size) + gearShapeSvg(geom, cx, cy, label) + svgFooter();
}

export type SpirographKitInput = {
  ring: GearGeometry;
  planet: GearGeometry;
  penHoleCount: number; // number of holes drilled into planet
  penHoleDiameter: number; // mm
  pageWidthMm?: number; // default A4 portrait
  pageHeightMm?: number;
};

// Produce a kit page: ring on the left, planet on the right, pen holes
// arranged along a spiral on the planet so they don't overlap, each tagged
// with its offset percentage.
export function exportSpirographKitSvg(input: SpirographKitInput): string {
  const margin = 8;
  const labelMargin = 14; // extra room around planet for outside labels
  const ringDia = input.ring.rimRadius * 2;
  const planetDia = input.planet.rimRadius * 2 + labelMargin * 2;
  const gap = 10;
  const w = Math.max(input.pageWidthMm ?? 0, ringDia + planetDia + gap + margin * 2);
  const h = Math.max(input.pageHeightMm ?? 0, Math.max(ringDia, planetDia) + margin * 2 + 16);

  const ringCx = margin + input.ring.rimRadius;
  const ringCy = margin + input.ring.rimRadius;
  const planetCx = ringCx + input.ring.rimRadius + gap + labelMargin + input.planet.rimRadius;
  const planetCy = margin + labelMargin + input.planet.rimRadius;

  const parts: string[] = [];
  parts.push(svgHeader(w, h));

  parts.push(
    gearShapeSvg(
      input.ring,
      ringCx,
      ringCy,
      `${input.ring.params.kind === "internal" ? "RING" : "SUN"} z=${input.ring.params.teeth} m=${input.ring.params.module}mm`,
    ),
  );
  parts.push(
    gearShapeSvg(
      input.planet,
      planetCx,
      planetCy,
      `PLANET z=${input.planet.params.teeth} m=${input.planet.params.module}mm`,
    ),
  );

  // Pen holes — shared layout helper so SVG and STL stay in sync.
  const penHoles = planetPenHolePositions(input.planet, input.penHoleCount, input.penHoleDiameter);
  const labelRimR = input.planet.rimRadius + 6;
  parts.push(`<g fill="none" stroke="black" stroke-width="${STROKE_MM}">`);
  for (const ph of penHoles) {
    const hp: Point = { x: planetCx + ph.x, y: planetCy + ph.y };
    const angle = Math.atan2(ph.y, ph.x);
    parts.push(`<circle cx="${hp.x.toFixed(3)}" cy="${hp.y.toFixed(3)}" r="${ph.radiusMm.toFixed(3)}"/>`);
    const labelP: Point = polar(planetCx, planetCy, labelRimR, angle);
    parts.push(
      `<line x1="${hp.x.toFixed(3)}" y1="${hp.y.toFixed(3)}" x2="${labelP.x.toFixed(3)}" y2="${labelP.y.toFixed(3)}" stroke-width="${(STROKE_MM / 2).toFixed(3)}" stroke-dasharray="0.4 0.6"/>`,
    );
    const isAbove = labelP.y < planetCy;
    const dy = isAbove ? -0.4 : 2.4;
    parts.push(
      `<text x="${labelP.x.toFixed(3)}" y="${(labelP.y + dy).toFixed(3)}" text-anchor="middle" font-family="monospace" font-size="2.4" fill="black" stroke="none">${(ph.offsetFraction * 100).toFixed(0)}%</text>`,
    );
  }
  parts.push("</g>");

  // Footer info
  parts.push(
    `<g font-family="monospace" font-size="3" fill="black"><text x="${margin}" y="${(h - 4).toFixed(2)}">ETCH-A-GEAR · ring ${input.ring.params.teeth} / planet ${input.planet.params.teeth} · module ${input.planet.params.module}mm · printed at 100% scale</text></g>`,
  );

  parts.push(svgFooter());
  return parts.join("\n");
}

export function downloadText(filename: string, text: string, type = "image/svg+xml;charset=utf-8"): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
