/**
 * The game emblem (GDD 2.14): a small gate on a path under a rising sun.
 *
 * The emblem is defined ONCE, as data: a list of primitive shapes in a 64x64 design space, painted in order.
 * `emblemSvg()` renders that data to SVG for the UI and the favicon; `tools/gen-icons.mjs` rasterises the
 * same data into the PNG app icons. Keep this file free of imports and of non-erasable TypeScript syntax
 * (no enums, namespaces or parameter properties) so Node can load it directly with type stripping.
 *
 * Ground shapes deliberately extend beyond the 64x64 square so the art still fills the frame when the
 * content is scaled down (maskable icon safe zone). Renderers always clip to the frame.
 */

export type EmblemPoint = readonly [x: number, y: number];

interface EmblemPaint {
  /** '#rrggbb' */
  readonly fill: string;
  /** 0..1, default 1 */
  readonly opacity?: number;
}

export interface EmblemCircle extends EmblemPaint {
  readonly kind: 'circle';
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
}

export interface EmblemPolygon extends EmblemPaint {
  readonly kind: 'polygon';
  /** Filled with the nonzero rule. */
  readonly points: readonly EmblemPoint[];
}

export interface EmblemRoundRect extends EmblemPaint {
  readonly kind: 'rect';
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** Corner radius; clamped to half the shorter side. */
  readonly r: number;
}

export type EmblemShape = EmblemCircle | EmblemPolygon | EmblemRoundRect;

/** 'rounded' = app-tile corners with transparent outside; 'square' = full bleed (iOS and maskable icons). */
export type EmblemFrame = 'rounded' | 'square';

export interface EmblemRenderOptions {
  /** Default 'rounded'. */
  readonly frame?: EmblemFrame;
  /** Scales the art (not the frame or background) about the centre. 1 = full size. */
  readonly contentScale?: number;
  /** Prefix for the SVG clip-path id; pass a unique value when inlining the emblem more than once. */
  readonly id?: string;
  /** Accessible name (already translated). Without it the SVG is marked decorative (aria-hidden). */
  readonly title?: string;
}

export const EMBLEM_DESIGN_SIZE = 64;
/** Corner radius of the 'rounded' frame in design units (about 22%, like a phone app tile). */
export const EMBLEM_CORNER_RADIUS = 14;
/** Night sky behind everything; also the PWA theme/background colour and the page theme-color. */
export const EMBLEM_BACKGROUND = '#2b2235';

const GLOW = '#ffb45e';
const SUN = '#ffd66e';
const HILL_FAR = '#3f6b4f';
const HILL_NEAR = '#5f9a55';
const PATH_EDGE = '#d4ad68';
const PATH = '#f6dfa8';
const WOOD_DARK = '#4a2f27';
const WOOD = '#7b4b35';
const DOORWAY_LIGHT = '#fff4d2';

/** Where the sun sits: just under the horizon, so it reads as rising behind the gate. */
const SUN_X = 32;
const SUN_Y = 42;

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/** A tapered sun ray: a triangle from the sun's rim outwards. Angles in degrees, 0 = right, -90 = up. */
function ray(angleDeg: number, inner: number, outer: number, halfWidthDeg: number): EmblemPolygon {
  const at = (deg: number, r: number): EmblemPoint => {
    const a = (deg * Math.PI) / 180;
    return [round3(SUN_X + Math.cos(a) * r), round3(SUN_Y + Math.sin(a) * r)];
  };
  return {
    kind: 'polygon',
    points: [at(angleDeg - halfWidthDeg, inner), at(angleDeg, outer), at(angleDeg + halfWidthDeg, inner)],
    fill: SUN,
    opacity: 0.9,
  };
}

/**
 * The Way as a ribbon down the screen (y grows downwards): its centre follows a gentle quadratic curve
 * from the gate's doorway, then runs straight on past the frame; it widens with distance like a road
 * seen in perspective. Sampled as [y, centreX, halfWidth].
 */
const WAY: ReadonlyArray<readonly [y: number, cx: number, halfWidth: number]> = (() => {
  const p0: EmblemPoint = [32, 45.6];
  const p1: EmblemPoint = [28.5, 57];
  const p2: EmblemPoint = [37, 70];
  const halfWidth = (y: number): number => 3.4 + (y - p0[1]) * 0.42;
  const samples: Array<readonly [number, number, number]> = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const u = 1 - t;
    const x = u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0];
    const y = u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1];
    samples.push([round3(y), round3(x), round3(halfWidth(y))]);
  }
  // Continue along the end tangent so the ribbon still fills the frame when the art is scaled down.
  const end: EmblemPoint = [p2[0] + (p2[0] - p1[0]) * 1.4, p2[1] + (p2[1] - p1[1]) * 1.4];
  samples.push([round3(end[1]), round3(end[0]), round3(halfWidth(end[1]))]);
  return samples;
})();

function wayRibbon(extraWidth: number, fill: string): EmblemPolygon {
  const left = WAY.map(([y, cx, hw]): EmblemPoint => [round3(cx - hw - extraWidth), y]);
  const right = WAY.map(([y, cx, hw]): EmblemPoint => [round3(cx + hw + extraWidth), y]).reverse();
  return { kind: 'polygon', points: [...left, ...right], fill };
}

/** Rolling horizon behind the gate; the hills run past the frame on three sides. */
// prettier-ignore
const FAR_HILLS: readonly EmblemPoint[] = [
  [-40, 50], [-4, 45], [10, 41.5], [22, 43], [32, 43.2], [44, 42.5], [56, 40.5], [70, 44], [104, 50],
  [104, 104], [-40, 104],
];
/** Nearer ground the path runs across; its crest sits just under the gate's feet. */
// prettier-ignore
const NEAR_GROUND: readonly EmblemPoint[] = [
  [-40, 58], [-2, 52], [14, 48.5], [28, 46], [32, 45.8], [40, 46.2], [54, 49], [68, 53], [104, 60],
  [104, 104], [-40, 104],
];

/** Painted in order, back to front. */
export const EMBLEM_SHAPES: readonly EmblemShape[] = [
  // Sunrise glow and rays.
  { kind: 'circle', cx: SUN_X, cy: SUN_Y, r: 28.5, fill: GLOW, opacity: 0.12 },
  { kind: 'circle', cx: SUN_X, cy: SUN_Y, r: 22, fill: GLOW, opacity: 0.2 },
  ray(-90, 17, 27.5, 6),
  ray(-57, 17, 26, 6),
  ray(-123, 17, 26, 6),
  ray(-25, 17, 24, 6),
  ray(-155, 17, 24, 6),
  { kind: 'circle', cx: SUN_X, cy: SUN_Y, r: 15, fill: SUN },
  // Far hills form the horizon (hiding the sun's lower half); near ground carries the path.
  { kind: 'polygon', points: FAR_HILLS, fill: HILL_FAR },
  { kind: 'polygon', points: NEAR_GROUND, fill: HILL_NEAR },
  // The Way: a warm ribbon with a darker edge, narrowing up to the gate.
  wayRibbon(1.2, PATH_EDGE),
  wayRibbon(0, PATH),
  // The gate: lit doorway, half-open door, posts, lintel and a little roof.
  { kind: 'rect', x: 28.5, y: 31.5, w: 7, h: 14.6, r: 0.6, fill: DOORWAY_LIGHT },
  {
    kind: 'polygon',
    points: [
      [35.5, 31.5],
      [32.6, 33.2],
      [32.6, 45.4],
      [35.5, 46.1],
    ],
    fill: WOOD,
  },
  {
    kind: 'polygon',
    points: [
      [21.5, 29.6],
      [32, 22.6],
      [42.5, 29.6],
    ],
    fill: WOOD,
  },
  { kind: 'rect', x: 24.5, y: 29.5, w: 4, h: 17, r: 1.2, fill: WOOD_DARK },
  { kind: 'rect', x: 35.5, y: 29.5, w: 4, h: 17, r: 1.2, fill: WOOD_DARK },
  { kind: 'rect', x: 23, y: 28, w: 18, h: 3.6, r: 1.4, fill: WOOD_DARK },
];

const fmt = (n: number): string => String(round3(n));

const escapeXml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function paintAttrs(shape: EmblemPaint): string {
  const opacity = shape.opacity ?? 1;
  return opacity < 1 ? `fill="${shape.fill}" fill-opacity="${fmt(opacity)}"` : `fill="${shape.fill}"`;
}

function shapeSvg(shape: EmblemShape): string {
  switch (shape.kind) {
    case 'circle':
      return `<circle cx="${fmt(shape.cx)}" cy="${fmt(shape.cy)}" r="${fmt(shape.r)}" ${paintAttrs(shape)}/>`;
    case 'polygon': {
      const pts = shape.points.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join(' ');
      return `<polygon points="${pts}" ${paintAttrs(shape)}/>`;
    }
    case 'rect': {
      const r = Math.min(shape.r, shape.w / 2, shape.h / 2);
      const rounded = r > 0 ? ` rx="${fmt(r)}" ry="${fmt(r)}"` : '';
      return (
        `<rect x="${fmt(shape.x)}" y="${fmt(shape.y)}" width="${fmt(shape.w)}" height="${fmt(shape.h)}"` +
        `${rounded} ${paintAttrs(shape)}/>`
      );
    }
  }
}

/** Renders the emblem as a standalone SVG string, `size` CSS pixels square. Output is deterministic. */
export function emblemSvg(size: number, options: EmblemRenderOptions = {}): string {
  const frame = options.frame ?? 'rounded';
  const scale = options.contentScale ?? 1;
  const id = options.id ?? 'pilgrim-emblem';
  const d = EMBLEM_DESIGN_SIZE;
  const c = d / 2;

  const a11y = options.title
    ? `role="img" aria-label="${escapeXml(options.title)}"`
    : 'aria-hidden="true" focusable="false"';
  const title = options.title ? `<title>${escapeXml(options.title)}</title>` : '';

  // A square frame is clipped by the SVG viewport itself; rounded corners need an explicit clip path.
  const clipId = `${id}-clip`;
  const r = EMBLEM_CORNER_RADIUS;
  const defs =
    frame === 'rounded'
      ? `<defs><clipPath id="${clipId}"><rect width="${d}" height="${d}" rx="${r}" ry="${r}"/></clipPath></defs>`
      : '';
  const clipAttr = frame === 'rounded' ? ` clip-path="url(#${clipId})"` : '';
  const transform =
    scale !== 1 ? ` transform="translate(${c} ${c}) scale(${fmt(scale)}) translate(${-c} ${-c})"` : '';
  const px = fmt(size);

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${d} ${d}" ${a11y}>` +
    title +
    defs +
    `<g${clipAttr}>` +
    `<rect width="${d}" height="${d}" fill="${EMBLEM_BACKGROUND}"/>` +
    `<g${transform}>${EMBLEM_SHAPES.map(shapeSvg).join('')}</g>` +
    `</g></svg>`
  );
}
