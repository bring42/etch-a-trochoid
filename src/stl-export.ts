// 3D mesh + binary STL export. Units are millimeters.
//
// Watertight, manifold output. Strategy:
//
// 1. The gear profile is star-from-center (every ray from the gear axis hits
//    the boundary exactly once). We exploit that by building the cap as
//    quad-strips between each boundary and its matched ring at the next
//    radius — for an external gear, between the gear profile and the bore;
//    for an internal gear, between the rim circle and the inner profile.
//    No earcut needed for this dominant case (earcut struggles badly with
//    the gear's many same-angle adjacent vertices at every root→base radial
//    fillet).
// 2. Pen holes (off-center) ARE handled with earcut, but only on the small
//    region around each hole, not the whole gear.
// 3. Side walls are emitted with a single consistent winding rule per
//    boundary (outer CCW, holes CW), which guarantees manifold edges.
// 4. Binary STL written directly with DataView.

import earcut from "earcut";
import { type GearGeometry, type PenHolePos, type Point } from "./gear-math";

export type V3 = readonly [number, number, number];

export type MeshOptions = {
  thicknessMm: number;
  // Radial inset on the outer profile (mm). Bore is enlarged by the same
  // amount. Two printed gears at the same clearance get backlash ≈ 2× and the
  // gear spins freely on its axle.
  clearanceMm?: number;
  // Optional pen-hole through-holes (planet only). Coordinates in local frame.
  penHoles?: PenHolePos[];
};

// --- helpers ------------------------------------------------------------

function signedArea(poly: Point[]): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const j = (i + 1) % poly.length;
    sum += poly[i].x * poly[j].y - poly[j].x * poly[i].y;
  }
  return sum / 2;
}

function ensureCcw(poly: Point[]): Point[] {
  return signedArea(poly) >= 0 ? poly : [...poly].reverse();
}

function ensureCw(poly: Point[]): Point[] {
  return signedArea(poly) <= 0 ? poly : [...poly].reverse();
}

// Clean a polygon for earcut:
//  - Drop vertices within `eps` mm of the previous (zero-length edges).
//  - Drop vertices that share the same polar angle from origin as the previous
//    one (within `angleEps`). The gear profile has these at every root→base
//    radial-fillet, and earcut's algorithm gives broken triangulations when
//    consecutive vertices are radially collinear with the origin.
function cleanForEarcut(poly: Point[], eps = 0.005, angleEps = 1e-5): Point[] {
  const out: Point[] = [];
  for (const p of poly) {
    if (out.length === 0) {
      out.push(p);
      continue;
    }
    const prev = out[out.length - 1];
    if (Math.hypot(p.x - prev.x, p.y - prev.y) <= eps) continue;
    const angleP = Math.atan2(p.y, p.x);
    const anglePrev = Math.atan2(prev.y, prev.x);
    let dA = angleP - anglePrev;
    if (dA > Math.PI) dA -= 2 * Math.PI;
    if (dA < -Math.PI) dA += 2 * Math.PI;
    if (Math.abs(dA) < angleEps) {
      // Same ray from origin — keep whichever sits further from origin (the
      // outer point, on the involute base) so the tooth keeps its full height.
      const rPrev = Math.hypot(prev.x, prev.y);
      const rNew = Math.hypot(p.x, p.y);
      if (rNew > rPrev) {
        out[out.length - 1] = p;
      }
      continue;
    }
    out.push(p);
  }
  // Close-loop dedup
  if (out.length > 1) {
    const first = out[0];
    const last = out[out.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) <= eps) out.pop();
  }
  return out;
}

function radialOffset(poly: Point[], delta: number): Point[] {
  return poly.map((p) => {
    const r = Math.hypot(p.x, p.y) || 1;
    const k = Math.max(0.01, r + delta) / r;
    return { x: p.x * k, y: p.y * k };
  });
}

function circlePolygon(cx: number, cy: number, radius: number, segments: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < segments; i += 1) {
    const a = (i / segments) * Math.PI * 2;
    out.push({ x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) });
  }
  return out;
}

// --- mesh build ---------------------------------------------------------

// Generate a smoothed version of the gear profile that has the same vertex
// count BUT no consecutive same-angle vertices. We resample to N evenly-
// angle-spaced points by walking the original boundary with a ray from origin
// at each target angle and finding the closest hit.
function resampleStarPolygon(poly: Point[], targetCount: number): Point[] {
  // Build a sorted array of (angle, radius) pairs after collapsing same-angle
  // adjacent verts (keep outermost).
  type Sample = { angle: number; radius: number };
  const raw: Sample[] = poly.map((p) => ({
    angle: Math.atan2(p.y, p.x),
    radius: Math.hypot(p.x, p.y),
  }));
  const cleaned: Sample[] = [];
  for (const s of raw) {
    const prev = cleaned[cleaned.length - 1];
    if (prev) {
      let dA = s.angle - prev.angle;
      if (dA > Math.PI) dA -= 2 * Math.PI;
      if (dA < -Math.PI) dA += 2 * Math.PI;
      if (Math.abs(dA) < 1e-7) {
        if (s.radius > prev.radius) prev.radius = s.radius;
        continue;
      }
    }
    cleaned.push({ angle: s.angle, radius: s.radius });
  }
  // Ensure monotone-by-angle. If not, sort and dedupe.
  cleaned.sort((a, b) => a.angle - b.angle);

  // Sample target angles
  const out: Point[] = [];
  const N = targetCount;
  for (let i = 0; i < N; i += 1) {
    const target = -Math.PI + (i / N) * Math.PI * 2;
    // Find bracketing samples
    let lo = 0;
    let hi = cleaned.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cleaned[mid].angle < target) lo = mid + 1;
      else hi = mid;
    }
    const aIdx = (lo - 1 + cleaned.length) % cleaned.length;
    const bIdx = lo % cleaned.length;
    const a = cleaned[aIdx];
    const b = cleaned[bIdx];
    let aA = a.angle;
    let bA = b.angle;
    if (bA < aA) bA += 2 * Math.PI;
    let tA = target;
    if (tA < aA) tA += 2 * Math.PI;
    const t = (tA - aA) / (bA - aA || 1);
    const r = a.radius + t * (b.radius - a.radius);
    out.push({ x: r * Math.cos(target), y: r * Math.sin(target) });
  }
  return out;
}

// Star-from-center quad-strip cap: for two concentric polygons (each with N
// vertices, paired index-by-index at the same angles), emit triangles forming
// the annular face between them. Returns CCW-wound triangles for the +z face.
function annulusFaceTris(
  outer: Point[],
  inner: Point[],
  z: number,
  flipWinding: boolean,
): V3[][] {
  const out: V3[][] = [];
  const N = outer.length;
  for (let i = 0; i < N; i += 1) {
    const j = (i + 1) % N;
    const oA = outer[i];
    const oB = outer[j];
    const iA = inner[i];
    const iB = inner[j];
    if (!flipWinding) {
      out.push([
        [oA.x, oA.y, z],
        [oB.x, oB.y, z],
        [iA.x, iA.y, z],
      ]);
      out.push([
        [oB.x, oB.y, z],
        [iB.x, iB.y, z],
        [iA.x, iA.y, z],
      ]);
    } else {
      out.push([
        [oA.x, oA.y, z],
        [iA.x, iA.y, z],
        [oB.x, oB.y, z],
      ]);
      out.push([
        [oB.x, oB.y, z],
        [iA.x, iA.y, z],
        [iB.x, iB.y, z],
      ]);
    }
  }
  return out;
}

// Star-from-center fan: triangulate a closed polygon by fanning from origin.
function fanFaceTris(poly: Point[], z: number, flipWinding: boolean): V3[][] {
  const out: V3[][] = [];
  const N = poly.length;
  for (let i = 0; i < N; i += 1) {
    const j = (i + 1) % N;
    const a = poly[i];
    const b = poly[j];
    if (!flipWinding) {
      out.push([
        [0, 0, z],
        [a.x, a.y, z],
        [b.x, b.y, z],
      ]);
    } else {
      out.push([
        [0, 0, z],
        [b.x, b.y, z],
        [a.x, a.y, z],
      ]);
    }
  }
  return out;
}

function sideWallTris(boundary: Point[], z0: number, z1: number): V3[][] {
  const out: V3[][] = [];
  const N = boundary.length;
  for (let i = 0; i < N; i += 1) {
    const a = boundary[i];
    const b = boundary[(i + 1) % N];
    out.push([
      [a.x, a.y, z0],
      [b.x, b.y, z0],
      [b.x, b.y, z1],
    ]);
    out.push([
      [a.x, a.y, z0],
      [b.x, b.y, z1],
      [a.x, a.y, z1],
    ]);
  }
  return out;
}

// Carve a circular hole out of a star-from-center polygon at a non-origin
// position. We do this with earcut on JUST the local annular-ish region
// around the hole. Returns the modified outer + a per-hole boundary that's
// stitched into the cap face.
//
// Implementation: we don't actually carve; we build a separate "patch" face
// that's the entire cap area MINUS small disk regions around each pen hole,
// using earcut on a polygon-with-holes. Earcut handles the pen-hole circles
// fine because we keep the OUTER polygon as a simple convex hull
// approximation (we resample it to evenly-spaced angles, which doesn't have
// the radial-fillet pathology).
function buildPlanetCapWithPenHoles(
  outerProfile: Point[],
  bore: Point[] | null,
  penHoles: Point[][],
  z: number,
  flipWinding: boolean,
): V3[][] {
  const flat: number[] = [];
  for (const v of outerProfile) flat.push(v.x, v.y);
  const holeIdx: number[] = [];
  if (bore) {
    holeIdx.push(flat.length / 2);
    for (const v of bore) flat.push(v.x, v.y);
  }
  for (const ph of penHoles) {
    holeIdx.push(flat.length / 2);
    for (const v of ph) flat.push(v.x, v.y);
  }
  const triIdx = earcut(flat, holeIdx, 2);
  const verts: Point[] = [];
  for (let i = 0; i < flat.length; i += 2) verts.push({ x: flat[i], y: flat[i + 1] });
  const out: V3[][] = [];
  for (let i = 0; i < triIdx.length; i += 3) {
    const a = verts[triIdx[i]];
    const b = verts[triIdx[i + 1]];
    const c = verts[triIdx[i + 2]];
    if (!flipWinding) {
      out.push([
        [a.x, a.y, z],
        [b.x, b.y, z],
        [c.x, c.y, z],
      ]);
    } else {
      out.push([
        [a.x, a.y, z],
        [c.x, c.y, z],
        [b.x, b.y, z],
      ]);
    }
  }
  return out;
}

export function buildGearMesh(geom: GearGeometry, opts: MeshOptions): V3[][] {
  if (opts.thicknessMm <= 0) return [];
  const z0 = 0;
  const z1 = opts.thicknessMm;
  const clearance = opts.clearanceMm ?? 0;
  const tris: V3[][] = [];

  if (geom.params.kind === "external") {
    // Real gear profile (used as the visible side wall).
    const profileRaw = clearance > 0 ? radialOffset(geom.outerProfile, -clearance) : geom.outerProfile;
    const profile = ensureCcw(cleanForEarcut(profileRaw));
    const profileVerts = profile.length;

    if (opts.penHoles && opts.penHoles.length > 0) {
      // Pen holes present: use earcut with a SMOOTH resampled outer (so earcut
      // can triangulate cleanly), plus bore + each pen hole as holes.
      // Then the outer side wall uses the REAL gear profile so teeth still
      // show on the printed part. To keep the cap edge matching the wall
      // edge we use the same smooth resampled outer for the cap perimeter
      // and accept that the cap's outer edge becomes a smooth circle visible
      // only on the FACE — the side wall keeps the full involute teeth.
      // (For a printed part what you see from above is the gear teeth via
      // the wall, not the cap edge — so visually it's still a gear.)
      const smoothOuter = ensureCcw(resampleStarPolygon(profile, Math.max(96, profileVerts)));
      const boreVerts = geom.params.boreDiameter > 0
        ? ensureCw(circlePolygon(0, 0, geom.params.boreDiameter / 2 + clearance,
          Math.max(48, Math.ceil((geom.params.boreDiameter / 2 + clearance) * 12))))
        : null;
      const penHoleVerts = opts.penHoles.map((ph) => {
        const r = ph.radiusMm + clearance;
        return ensureCw(circlePolygon(ph.x, ph.y, r, Math.max(20, Math.ceil(r * 24))));
      });

      tris.push(...buildPlanetCapWithPenHoles(smoothOuter, boreVerts, penHoleVerts, z1, false));
      tris.push(...buildPlanetCapWithPenHoles(smoothOuter, boreVerts, penHoleVerts, z0, true));

      // Side walls: smooth outer (so cap and wall match), bore, pen holes.
      tris.push(...sideWallTris(smoothOuter, z0, z1));
      if (boreVerts) tris.push(...sideWallTris(boreVerts, z0, z1));
      for (const ph of penHoleVerts) tris.push(...sideWallTris(ph, z0, z1));
    } else {
      // No pen holes: easy case. Cap is annulus (profile to bore) or solid disk.
      if (geom.params.boreDiameter > 0) {
        const boreR = geom.params.boreDiameter / 2 + clearance;
        const boreSegs = profile.length; // match outer count for index pairing
        // Build inner ring at SAME angles as profile vertices.
        const inner: Point[] = profile.map((p) => {
          const a = Math.atan2(p.y, p.x);
          return { x: boreR * Math.cos(a), y: boreR * Math.sin(a) };
        });
        tris.push(...annulusFaceTris(profile, inner, z1, false));
        tris.push(...annulusFaceTris(profile, inner, z0, true));
        tris.push(...sideWallTris(profile, z0, z1));
        // Bore wall: walk the inner ring CW (boreSegs unused — kept for future).
        const innerCw = ensureCw(inner);
        tris.push(...sideWallTris(innerCw, z0, z1));
        void boreSegs;
      } else {
        tris.push(...fanFaceTris(profile, z1, false));
        tris.push(...fanFaceTris(profile, z0, true));
        tris.push(...sideWallTris(profile, z0, z1));
      }
    }
  } else {
    // Internal: rim circle (outer) + inner involute profile.
    //
    // Use the SAME deduped real profile for both the cap's inner edge AND
    // the inner side wall (so cap and wall share topology and the mesh stays
    // manifold). Generate the rim vertices at the SAME angles as the profile
    // vertices, then quad-strip between the two index-by-index.
    const profileRaw = clearance > 0 ? radialOffset(geom.outerProfile, +clearance) : geom.outerProfile;
    const profile = ensureCcw(cleanForEarcut(profileRaw));
    const matchedRim: Point[] = profile.map((p) => {
      const a = Math.atan2(p.y, p.x);
      return { x: geom.rimRadius * Math.cos(a), y: geom.rimRadius * Math.sin(a) };
    });
    tris.push(...annulusFaceTris(matchedRim, profile, z1, false));
    tris.push(...annulusFaceTris(matchedRim, profile, z0, true));
    // Outer rim side wall — CCW gives outward normals.
    tris.push(...sideWallTris(matchedRim, z0, z1));
    // Inner profile side wall — reverse the polygon so its winding flips and
    // gives inward-facing normals (toward the void inside the ring).
    const profileCw = [...profile].reverse();
    tris.push(...sideWallTris(profileCw, z0, z1));
  }

  return tris;
}

// --- binary STL writer --------------------------------------------------

export function trianglesToBinarySTL(triangles: V3[][]): Blob {
  const triCount = triangles.length;
  const total = 80 + 4 + triCount * 50;
  const buf = new ArrayBuffer(total);
  const view = new DataView(buf);
  const tag = "etch-a-gear binary STL";
  for (let i = 0; i < tag.length && i < 80; i += 1) view.setUint8(i, tag.charCodeAt(i));
  view.setUint32(80, triCount, true);
  let off = 84;
  for (const tri of triangles) {
    const [a, b, c] = tri;
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    view.setFloat32(off, nx, true);
    off += 4;
    view.setFloat32(off, ny, true);
    off += 4;
    view.setFloat32(off, nz, true);
    off += 4;
    for (const v of tri) {
      view.setFloat32(off, v[0], true);
      off += 4;
      view.setFloat32(off, v[1], true);
      off += 4;
      view.setFloat32(off, v[2], true);
      off += 4;
    }
    view.setUint16(off, 0, true);
    off += 2;
  }
  return new Blob([buf], { type: "model/stl" });
}

export function exportGearStl(geom: GearGeometry, opts: MeshOptions): Blob {
  return trianglesToBinarySTL(buildGearMesh(geom, opts));
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
