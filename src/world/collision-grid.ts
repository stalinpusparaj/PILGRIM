/**
 * Uniform grid broadphase for CollisionWorld (GDD 2.15: no physics engine). The map (size × size metres, centred
 * on the origin) is cut into square cells (~8 m); each cell lists the ids of the colliders whose x/z bounds touch
 * it. Queries walk the cells under an x/z box and hand back each live id once (a per-query stamp de-duplicates
 * colliders that span several cells). Points off the map clamp to the edge cells. Queries never allocate.
 */

export class UniformGrid {
  /** Cell edge in metres. */
  readonly cell: number;
  /** Cells per side. */
  readonly n: number;
  private readonly half: number;
  private readonly cells: number[][];
  /** Last stamp each id was seen with (de-duplication across cells). */
  private marks = new Uint32Array(64);
  private stamp = 0;
  /** Ids found by the last collect() calls of the current query. */
  found = new Int32Array(128);
  /** Number of valid entries in `found`. */
  count = 0;

  constructor(size: number, cell = 8) {
    const s = Number.isFinite(size) && size > 0 ? size : 300;
    this.n = Math.max(1, Math.ceil(s / cell));
    this.cell = s / this.n;
    this.half = s / 2;
    this.cells = [];
    for (let i = 0; i < this.n * this.n; i++) this.cells.push([]);
  }

  private ix(x: number): number {
    const i = Math.floor((x + this.half) / this.cell);
    return i < 0 ? 0 : i >= this.n ? this.n - 1 : i;
  }

  /** Adds `id` to every cell under the box; `outCells` receives the cell indices (kept for removal). */
  insert(id: number, minX: number, minZ: number, maxX: number, maxZ: number, outCells: number[]): void {
    if (id >= this.marks.length) {
      let len = this.marks.length;
      while (len <= id) len *= 2;
      const next = new Uint32Array(len);
      next.set(this.marks);
      this.marks = next;
    }
    const i0 = this.ix(minX);
    const i1 = this.ix(maxX);
    const j0 = this.ix(minZ);
    const j1 = this.ix(maxZ);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const c = j * this.n + i;
        this.cells[c]!.push(id);
        outCells.push(c);
      }
    }
  }

  /** Removes `id` from the given cells (the list insert() filled). */
  remove(id: number, cells: readonly number[]): void {
    for (let k = 0; k < cells.length; k++) {
      const list = this.cells[cells[k]!]!;
      const at = list.indexOf(id);
      if (at >= 0) list.splice(at, 1);
    }
  }

  /** Starts a query: ids seen from here on are reported once, however many collect() calls follow. */
  begin(): void {
    this.count = 0;
    this.stamp = (this.stamp + 1) >>> 0;
    if (this.stamp === 0) {
      this.marks.fill(0);
      this.stamp = 1;
    }
  }

  /**
   * Appends the ids under the x/z box that this query has not reported yet to `found` (from `count`), and
   * returns the new count. `accept` filters ids (disabled or removed colliders) without a closure per call.
   */
  collect(minX: number, minZ: number, maxX: number, maxZ: number, accept: (id: number) => boolean): number {
    const i0 = this.ix(minX);
    const i1 = this.ix(maxX);
    const j0 = this.ix(minZ);
    const j1 = this.ix(maxZ);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const list = this.cells[j * this.n + i]!;
        for (let k = 0; k < list.length; k++) {
          const id = list[k]!;
          if (this.marks[id] === this.stamp) continue;
          this.marks[id] = this.stamp;
          if (!accept(id)) continue;
          if (this.count >= this.found.length) {
            const next = new Int32Array(this.found.length * 2);
            next.set(this.found);
            this.found = next;
          }
          this.found[this.count++] = id;
        }
      }
    }
    return this.count;
  }

  /** begin() + collect() in one call. */
  query(minX: number, minZ: number, maxX: number, maxZ: number, accept: (id: number) => boolean): number {
    this.begin();
    return this.collect(minX, minZ, maxX, maxZ, accept);
  }

  clear(): void {
    for (const list of this.cells) list.length = 0;
    this.count = 0;
  }
}
