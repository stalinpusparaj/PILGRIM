/**
 * MAP page (GDD 2.14, 2.7.8): a top-down sketch of the current level drawn as inline SVG from its level file.
 *  - The Way in gold (the same centripetal Catmull-Rom curve the world is built from, src/gen/terrain/spline.ts).
 *  - Detours taken (state.data.detours ∩ level.detours) in solid red; detours not taken faint and dashed, so the
 *    difference is a shape as well as a colour (GDD 2.15 accessibility).
 *  - Waystones as little stones (the last one used gets a gold ring), the far light at the end of the Way,
 *    houses / gates / the cross as tiny marks, water and hills as soft shapes, and the player as a marker with
 *    a facing arrow. World x runs right and world z runs down. No pan or zoom.
 */
import { t } from '../core/I18n';
import { evalSpline } from '../gen/terrain/spline';
import type { LevelData, Vec3 } from '../world/LevelTypes';
import { h } from './dom';
import { uiIcon } from './satchel-icons';
import { emptyNote, svgSpan, type PageResult, type SatchelPlayer, type SatchelView } from './satchel-view';

const NS = 'http://www.w3.org/2000/svg';
/** Most points kept per drawn curve (the spline is evaluated every 0.25 m). */
const MAX_CURVE_POINTS = 360;
const MIN_SPAN = 40;
/** Blank border around the content, as a share of its larger side. */
const MARGIN = 0.08;
/** The map is at most this much wider than tall (and at most a little taller than wide). */
const MAX_ASPECT = 1.8;
const MIN_ASPECT = 0.8;

type Attrs = Record<string, string | number>;

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Attrs,
  ...kids: SVGElement[]
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  el.append(...kids);
  return el;
}

interface Pt {
  x: number;
  z: number;
}

/** The level curve as a light polyline (x, z). */
export function curvePoints(points: readonly Vec3[]): Pt[] {
  if (points.length === 0) return [];
  if (points.length === 1) return [{ x: points[0]![0], z: points[0]![2] }];
  const raw = evalSpline([...points]);
  const step = Math.max(1, Math.ceil(raw.x.length / MAX_CURVE_POINTS));
  const out: Pt[] = [];
  for (let i = 0; i < raw.x.length; i += step) out.push({ x: raw.x[i]!, z: raw.z[i]! });
  const last = raw.x.length - 1;
  if (last % step !== 0) out.push({ x: raw.x[last]!, z: raw.z[last]! });
  return out;
}

function pathData(pts: readonly Pt[]): string {
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.z.toFixed(1)}`).join('');
}

interface Box {
  x: number;
  z: number;
  w: number;
  h: number;
}

/** View box around everything worth showing (the Way, detours, waystones, the player), shaped like the content. */
function viewBox(level: LevelData, curves: Pt[][], player: SatchelPlayer | null): Box {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  const add = (x: number, z: number): void => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  };
  for (const c of curves) for (const p of c) add(p.x, p.z);
  for (const w of level.waystones) add(w.at[0], w.at[2]);
  if (player) add(player.x, player.z);
  if (!Number.isFinite(minX)) {
    const half = level.size / 2;
    return { x: -half, z: -half, w: level.size, h: level.size };
  }
  let w = Math.max(maxX - minX, MIN_SPAN / 2);
  let h = Math.max(maxZ - minZ, MIN_SPAN / 2);
  const margin = Math.max(w, h) * MARGIN;
  w += 2 * margin;
  h += 2 * margin;
  if (w / h > MAX_ASPECT) h = w / MAX_ASPECT;
  else if (w / h < MIN_ASPECT) w = h * MIN_ASPECT;
  return { x: (minX + maxX) / 2 - w / 2, z: (minZ + maxZ) / 2 - h / 2, w, h };
}

export function renderMap(view: SatchelView): PageResult {
  const level = view.map?.level ?? null;
  if (!level) return { el: emptyNote(t('ui.satchel.map.none'), 'map:none') };
  const player = view.map?.player ?? null;
  const taken = new Set(view.state.data.detours);

  const way = curvePoints(level.way);
  const detours = level.detours
    .map((d) => ({ id: d.id, pts: curvePoints(d.points) }))
    .filter((d) => d.pts.length > 1);
  const box = viewBox(level, [way, ...detours.map((d) => d.pts)], player);
  const u = Math.max(box.w, box.h) / 100; // one "map unit": 1 % of the view

  const root = svg('svg', {
    viewBox: `${box.x.toFixed(1)} ${box.z.toFixed(1)} ${box.w.toFixed(1)} ${box.h.toFixed(1)}`,
    class: 'pg-satchel__mapSvg',
    role: 'img',
    'aria-label': t('ui.satchel.map.label'),
    preserveAspectRatio: 'xMidYMid meet',
  });
  root.append(
    svg('rect', { x: box.x, y: box.z, width: box.w, height: box.h, rx: 4 * u, class: 'pg-map__paper' }),
    terrainLayer(level, u),
    landmarkLayer(level, u),
  );
  for (const d of detours) {
    if (!taken.has(d.id)) root.append(svg('path', { d: pathData(d.pts), class: 'pg-map__detour' }));
  }
  if (way.length > 1) {
    const d = pathData(way);
    root.append(svg('path', { d, class: 'pg-map__wayEdge' }), svg('path', { d, class: 'pg-map__way' }));
  }
  for (const d of detours) {
    if (taken.has(d.id)) {
      const dd = pathData(d.pts);
      root.append(
        svg('path', { d: dd, class: 'pg-map__takenEdge' }),
        svg('path', { d: dd, class: 'pg-map__taken' }),
      );
    }
  }
  for (const w of level.waystones) root.append(stone(w.at[0], w.at[2], u, w.id === view.state.waystone));
  const end = way[way.length - 1];
  if (end) root.append(farLight(end.x, end.z, u));
  if (player) root.append(playerMarker(player, u));

  const figure = h(
    'figure',
    {
      className: 'pg-satchel__map',
      tabIndex: 0,
      dataset: { key: 'map' },
      'aria-label': t('ui.satchel.map.label'),
    },
    root,
    legend(
      detours.some((d) => taken.has(d.id)),
      detours.some((d) => !taken.has(d.id)),
      player !== null,
    ),
  );
  return { el: figure };
}

function terrainLayer(level: LevelData, u: number): SVGGElement {
  const g = svg('g', { class: 'pg-map__terrain' });
  for (const st of level.terrain.stamps) {
    if (st.type !== 'hill' && st.type !== 'plateau' && st.type !== 'ridge') continue;
    g.append(
      svg('circle', { cx: st.x, cy: st.z, r: st.r, class: 'pg-map__hill' }),
      svg('circle', { cx: st.x, cy: st.z, r: st.r * 0.55, class: 'pg-map__hillTop' }),
    );
  }
  for (const w of level.water ?? []) {
    const cls = w.kind === 'mud' ? 'pg-map__mud' : 'pg-map__water';
    if (w.shape === 'circle') g.append(svg('circle', { cx: w.x, cy: w.z, r: w.r ?? 4 * u, class: cls }));
    else {
      const [sx, sz] = w.size ?? [8 * u, 8 * u];
      g.append(
        svg('rect', { x: w.x - sx / 2, y: w.z - sz / 2, width: sx, height: sz, rx: 2 * u, class: cls }),
      );
    }
  }
  return g;
}

/** Tiny marks for a few readable landmark kinds (houses, gates, the cross). */
function landmarkLayer(level: LevelData, u: number): SVGGElement {
  const g = svg('g', { class: 'pg-map__marks' });
  const k = 1.6 * u;
  for (const lm of level.landmarks) {
    if (!lm.at) continue;
    const [x, , z] = lm.at;
    const type = lm.type.toLowerCase();
    let d = '';
    if (type.includes('house'))
      d = `M${x - k} ${z + k}V${z - 0.2 * k}L${x} ${z - 1.3 * k}L${x + k} ${z - 0.2 * k}V${z + k}Z`;
    else if (type.includes('gate'))
      d = `M${x - k} ${z + k}V${z - k}H${x + k}V${z + k}M${x} ${z - k}V${z + k}`;
    else if (type.includes('cross'))
      d = `M${x} ${z - 1.4 * k}V${z + 1.2 * k}M${x - 0.8 * k} ${z - 0.6 * k}H${x + 0.8 * k}`;
    if (d) g.append(svg('path', { d, class: type.includes('house') ? 'pg-map__house' : 'pg-map__mark' }));
  }
  return g;
}

function stone(x: number, z: number, u: number, current: boolean): SVGGElement {
  const w = 2.6 * u;
  const g = svg('g', { class: 'pg-map__stone' });
  if (current) g.append(svg('circle', { cx: x, cy: z, r: 2.6 * u, class: 'pg-map__stoneRing' }));
  g.append(
    svg('rect', {
      x: x - w / 2,
      y: z - w * 0.7,
      width: w,
      height: w * 1.3,
      rx: w * 0.45,
      class: 'pg-map__stoneBody',
    }),
    svg('path', { d: `M${x - w * 0.22} ${z - w * 0.15}H${x + w * 0.22}`, class: 'pg-map__stoneMark' }),
  );
  return g;
}

function farLight(x: number, z: number, u: number): SVGGElement {
  const r = 3.2 * u;
  const d =
    `M${x} ${z - r}C${x + 0.18 * r} ${z - 0.18 * r} ${x + 0.18 * r} ${z - 0.18 * r} ${x + r} ${z}` +
    `C${x + 0.18 * r} ${z + 0.18 * r} ${x + 0.18 * r} ${z + 0.18 * r} ${x} ${z + r}` +
    `C${x - 0.18 * r} ${z + 0.18 * r} ${x - 0.18 * r} ${z + 0.18 * r} ${x - r} ${z}` +
    `C${x - 0.18 * r} ${z - 0.18 * r} ${x - 0.18 * r} ${z - 0.18 * r} ${x} ${z - r}Z`;
  return svg(
    'g',
    { class: 'pg-map__light' },
    svg('circle', { cx: x, cy: z, r: r * 1.15, class: 'pg-map__lightGlow' }),
    svg('path', { d, class: 'pg-map__lightStar' }),
  );
}

function playerMarker(p: SatchelPlayer, u: number): SVGGElement {
  const r = 2.3 * u;
  const g = svg('g', {
    class: 'pg-map__player',
    transform: `translate(${p.x.toFixed(1)} ${p.z.toFixed(1)})`,
  });
  g.append(svg('circle', { cx: 0, cy: 0, r: r * 1.9, class: 'pg-map__pulse' }));
  const hd = p.heading;
  if (hd && Math.hypot(hd.x, hd.z) > 1e-4) {
    const deg = (Math.atan2(hd.z, hd.x) * 180) / Math.PI;
    g.append(
      svg('path', {
        d: `M${r * 2.3} 0L${r * 0.6} ${-r * 1.05}L${r * 0.6} ${r * 1.05}Z`,
        class: 'pg-map__arrow',
        transform: `rotate(${deg.toFixed(1)})`,
      }),
    );
  }
  g.append(svg('circle', { cx: 0, cy: 0, r, class: 'pg-map__you' }));
  return g;
}

/** Legend: each entry pairs a drawn sample (line style / shape) with its words. */
function legend(hasTaken: boolean, hasOther: boolean, hasPlayer: boolean): HTMLUListElement {
  const sample = (cls: string): SVGSVGElement =>
    svg(
      'svg',
      { viewBox: '0 0 40 16', width: 40, height: 16, 'aria-hidden': 'true', class: 'pg-map__sample' },
      svg('path', { d: 'M3 8H37', class: cls }),
    );
  const item = (swatch: Element, key: string): HTMLLIElement =>
    h('li', { className: 'pg-satchel__legendItem' }, swatch, h('span', null, t(key)));
  const ul = h('ul', { className: 'pg-satchel__legend', role: 'list' });
  const way = sample('pg-map__way');
  way.prepend(svg('path', { d: 'M3 8H37', class: 'pg-map__wayEdge' }));
  ul.append(item(way, 'ui.satchel.map.legend.way'));
  if (hasTaken) ul.append(item(sample('pg-map__taken'), 'ui.satchel.map.legend.detour'));
  if (hasOther) ul.append(item(sample('pg-map__detour'), 'ui.satchel.map.legend.other'));
  const stoneSample = svg('svg', { viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': 'true' });
  stoneSample.append(svg('rect', { x: 4, y: 2, width: 8, height: 12, rx: 3.6, class: 'pg-map__stoneBody' }));
  ul.append(item(stoneSample, 'ui.satchel.map.legend.waystone'));
  ul.append(item(svgSpan('pg-map__legendStar', uiIcon('sparkle', '16px')), 'ui.satchel.map.legend.light'));
  if (hasPlayer) {
    const you = svg('svg', { viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': 'true' });
    you.append(svg('circle', { cx: 8, cy: 8, r: 5.5, class: 'pg-map__you' }));
    ul.append(item(you, 'ui.satchel.map.legend.you'));
  }
  return ul;
}
