import type { Endpoint } from "comlink";

/** Comlink replies do not include native Worker failures. Keep those failures and
 * deadlines outside the RPC channel so a stopped worker cannot leave callers waiting.
 */
export class WorkerLifecycle {
  readonly endpoint: Endpoint;
  readonly #pending = new Set<(reason: unknown) => void>();
  readonly #listeners = new Set<{ type: string; listener: EventListenerOrEventListenerObject; options?: {} }>();
  #terminated = false;
  #reason: unknown;

  constructor(readonly worker: Pick<Worker, "addEventListener" | "removeEventListener" | "postMessage" | "terminate">) {
    // Comlink keeps its pending RPC map in its message listener. Detach that
    // listener on termination as well: a stalled init can otherwise retain its
    // proxy through Comlink's FinalizationRegistry even after the Worker stops.
    this.endpoint = {
      postMessage: (message, transfer) => {
        // Comlink finalizers can try to send RELEASE after a stopped worker has
        // been discarded. No remote acknowledgement is required for teardown.
        if (!this.#terminated) worker.postMessage(message, transfer ?? []);
      },
      addEventListener: (type, listener, options) => {
        if (this.#terminated) return;
        this.#listeners.add({ type, listener, options });
        worker.addEventListener(type, listener, options);
      },
      removeEventListener: (type, listener, options) => {
        worker.removeEventListener(type, listener, options);
        for (const entry of this.#listeners) {
          if (entry.type === type && entry.listener === listener) this.#listeners.delete(entry);
        }
      },
    };
    worker.addEventListener("error", this.#onError);
    worker.addEventListener("messageerror", this.#onMessageError);
  }

  get terminated(): boolean { return this.#terminated; }

  readonly #onError = (event: Event): void => {
    event.preventDefault();
    const message = (event as ErrorEvent).message;
    this.terminate(new Error(typeof message === "string" && message.trim()
      ? `STEP worker failed: ${message}` : "STEP worker failed to start or stopped unexpectedly."));
  };

  readonly #onMessageError = (): void => {
    this.terminate(new Error("Unable to read the STEP worker response."));
  };

  run<T>(operation: () => Promise<T>, timeoutMs: number, phase: string): Promise<T> {
    if (this.#terminated) return Promise.reject(this.#reason);
    return new Promise<T>((resolve, reject) => {
      const cleanup = (): void => {
        clearTimeout(timer);
        this.#pending.delete(fail);
      };
      const fail = (reason: unknown): void => { cleanup(); reject(reason); };
      const timer = setTimeout(() => {
        this.terminate(new DOMException(`${phase} exceeded its ${timeoutMs / 1000} second time limit.`, "TimeoutError"));
      }, timeoutMs);
      this.#pending.add(fail);
      try {
        operation().then(value => { cleanup(); resolve(value); }, fail);
      } catch (error) { fail(error); }
    });
  }

  terminate(reason: unknown = new DOMException("The STEP worker was terminated.", "AbortError")): void {
    if (this.#terminated) return;
    this.#terminated = true;
    this.#reason = reason;
    this.worker.removeEventListener("error", this.#onError);
    this.worker.removeEventListener("messageerror", this.#onMessageError);
    for (const { type, listener, options } of this.#listeners) this.worker.removeEventListener(type, listener, options);
    this.#listeners.clear();
    for (const fail of this.#pending) fail(reason);
    this.worker.terminate();
  }
}
