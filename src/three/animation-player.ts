import * as THREE from "three";

/** One selected clip; bindings live below the editable import wrapper. */
export class AnimationPlayer {
  #root: THREE.Object3D | null = null;
  #mixer: THREE.AnimationMixer | null = null;
  #action: THREE.AnimationAction | null = null;
  #speed = 1;
  playing = false;
  get root(): THREE.Object3D | null { return this.#root; }
  get time(): number { return this.#action?.time ?? 0; }
  get duration(): number { return this.#action?.getClip().duration ?? 0; }
  select(root: THREE.Object3D, clip: THREE.AnimationClip): void {
    this.clear();
    this.#root = root;
    this.#mixer = new THREE.AnimationMixer(root);
    this.#action = this.#mixer.clipAction(clip);
    this.#action.setLoop(THREE.LoopOnce, 1);
    this.#action.clampWhenFinished = true;
    this.#action.play();
    this.#mixer.addEventListener("finished", () => { this.playing = false; });
    this.#mixer.update(0);
  }
  play(): void {
    if (!this.#action) return;
    if (this.time >= this.duration) this.#action.reset().play();
    this.#action.paused = false;
    this.playing = true;
  }
  pause(): void { this.playing = false; }
  seek(seconds: number): void {
    if (!this.#mixer || !this.#action || !Number.isFinite(seconds)) return;
    this.#action.paused = false;
    this.#action.time = Math.max(0, Math.min(this.duration, seconds));
    this.#mixer.update(0);
  }
  setSpeed(speed: number): void {
    if (Number.isFinite(speed)) this.#speed = Math.max(0.1, Math.min(4, speed));
  }
  update(delta: number): void { if (this.playing) this.#mixer?.update(delta * this.#speed); }
  clear(): void {
    this.playing = false;
    this.#mixer?.stopAllAction();
    if (this.#root) this.#mixer?.uncacheRoot(this.#root);
    this.#root = null; this.#mixer = null; this.#action = null;
  }
}
