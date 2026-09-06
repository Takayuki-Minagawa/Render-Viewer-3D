/** Coalesces invalidations. Only an explicitly active animation schedules another frame. */
export class DemandRenderer {
  #frame: number | null = null;
  #disposed = false;
  #lastTime: number | null = null;
  constructor(
    private readonly render: (deltaSeconds: number) => boolean,
    private readonly schedule: typeof requestAnimationFrame = (callback) => requestAnimationFrame(callback),
    private readonly cancel: typeof cancelAnimationFrame = (id) => cancelAnimationFrame(id),
  ) {}
  request(): void {
    if (this.#disposed || this.#frame !== null) return;
    this.#frame = this.schedule((time) => {
      this.#frame = null;
      const delta = this.#lastTime === null ? 0 : Math.min((time - this.#lastTime) / 1000, 0.1);
      this.#lastTime = time;
      if (this.render(delta)) this.request();
      else this.#lastTime = null;
    });
  }
  pause(): void {
    if (this.#frame !== null) this.cancel(this.#frame);
    this.#frame = null;
    this.#lastTime = null;
  }
  dispose(): void { this.pause(); this.#disposed = true; }
}
