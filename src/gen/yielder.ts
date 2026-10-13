/** Time-slicing so heavy generation never freezes the page or the loading bar (GDD 2.12). */

/** Resolves on the next animation frame (falls back to a timeout when the tab is hidden and rAF is paused). */
export function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      resolve();
    };
    requestAnimationFrame(finish);
    setTimeout(finish, 50);
  });
}

/**
 * Call `await y.tick()` between chunks of work (a terrain row, a batch of props). It only actually yields when
 * the current slice has used up its budget, so it is cheap to call often.
 */
export class Yielder {
  private sliceStart = performance.now();
  /** Total milliseconds spent working (excludes time spent yielded). */
  workMs = 0;

  constructor(private readonly budgetMs = 8) {}

  async tick(): Promise<void> {
    const now = performance.now();
    if (now - this.sliceStart < this.budgetMs) return;
    this.workMs += now - this.sliceStart;
    await nextFrame();
    this.sliceStart = performance.now();
  }

  /** Close the current slice (call at the end of a build to make workMs exact). */
  finish(): number {
    this.workMs += performance.now() - this.sliceStart;
    this.sliceStart = performance.now();
    return this.workMs;
  }
}
