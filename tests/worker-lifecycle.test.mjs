import assert from "node:assert/strict";
import { before, after, describe, it } from "node:test";
import { createServer } from "vite";
import * as Comlink from "comlink";

let server, WorkerLifecycle;
before(async () => {
  server = await createServer({ appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  ({ WorkerLifecycle } = await server.ssrLoadModule("/src/importers/worker-lifecycle.ts"));
});
after(() => server?.close());

class FakeWorker extends EventTarget {
  listeners = new Set();
  terminateCalls = 0;
  messages = [];
  addEventListener(type, listener, options) {
    this.listeners.add(type);
    super.addEventListener(type, listener, options);
  }
  removeEventListener(type, listener, options) {
    this.listeners.delete(type);
    super.removeEventListener(type, listener, options);
  }
  terminate() { this.terminateCalls += 1; }
  postMessage(message) { this.messages.push(message); }
}

describe("WorkerLifecycle", () => {
  for (const type of ["error", "messageerror"]) {
    it(`rejects all pending calls on ${type} and removes its listeners`, async () => {
      const worker = new FakeWorker();
      const lifecycle = new WorkerLifecycle(worker);
      const pending = [lifecycle.run(() => new Promise(() => {}), 1000, "Init"), lifecycle.run(() => new Promise(() => {}), 1000, "Parse")];
      const rejected = pending.map(promise => assert.rejects(promise, type === "error" ? /STEP worker failed/ : /STEP worker response/));
      worker.dispatchEvent(new Event(type));
      await Promise.all(rejected);
      assert.equal(lifecycle.terminated, true);
      assert.equal(worker.terminateCalls, 1);
      assert.equal(worker.listeners.size, 0);
      lifecycle.terminate();
      assert.equal(worker.terminateCalls, 1);
    });
  }

  it("preserves a native error message", async () => {
    const worker = new FakeWorker();
    const lifecycle = new WorkerLifecycle(worker);
    const rejected = assert.rejects(lifecycle.run(() => new Promise(() => {}), 1000, "Init"), /STEP worker failed: module not found/);
    const event = new Event("error");
    Object.defineProperty(event, "message", { value: "module not found" });
    worker.dispatchEvent(event);
    await rejected;
  });

  for (const phase of ["STEP worker initialization", "STEP parsing", "STEP tessellation", "STEP assembly parsing", "STEP cleanup"]) {
    it(`terminates a silent worker during ${phase}`, { timeout: 1000 }, async () => {
      const worker = new FakeWorker();
      const lifecycle = new WorkerLifecycle(worker);
      await assert.rejects(lifecycle.run(() => new Promise(() => {}), 5, phase), error => error.name === "TimeoutError" && error.message.includes(phase));
      assert.equal(worker.terminateCalls, 1);
      assert.equal(worker.listeners.size, 0);
    });
  }

  it("cancels pending work with the supplied reason and prevents further work", async () => {
    const worker = new FakeWorker();
    const lifecycle = new WorkerLifecycle(worker);
    const reason = new Error("user cancelled");
    const rejected = assert.rejects(lifecycle.run(() => new Promise(() => {}), 1000, "Parse"), error => error === reason);
    lifecycle.terminate(reason);
    await rejected;
    let invoked = false;
    await assert.rejects(lifecycle.run(async () => { invoked = true; }, 1000, "Cleanup"), error => error === reason);
    assert.equal(invoked, false);
    assert.equal(worker.terminateCalls, 1);
  });

  it("removes deadlines after success and RPC rejection without prematurely terminating", async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const worker = new FakeWorker();
    const lifecycle = new WorkerLifecycle(worker);
    assert.equal(await lifecycle.run(async () => 42, 10, "Parse"), 42);
    const error = new Error("parser rejected input");
    await assert.rejects(lifecycle.run(async () => { throw error; }, 10, "Parse"), reason => reason === error);
    await assert.rejects(lifecycle.run(() => { throw error; }, 10, "Parse"), reason => reason === error);
    t.mock.timers.tick(100);
    assert.equal(worker.terminateCalls, 0);
    lifecycle.terminate();
    assert.equal(worker.listeners.size, 0);
  });

  it("ignores late replies after termination", async () => {
    const worker = new FakeWorker();
    const lifecycle = new WorkerLifecycle(worker);
    let reply;
    const pending = lifecycle.run(() => new Promise(resolve => { reply = resolve; }), 1000, "Parse");
    const rejected = assert.rejects(pending, { name: "AbortError" });
    lifecycle.terminate();
    reply("late model");
    await rejected;
    assert.equal(worker.terminateCalls, 1);
  });

  it("detaches the Comlink listener retaining an unanswered RPC and ignores finalizer messages", async () => {
    const worker = new FakeWorker();
    const lifecycle = new WorkerLifecycle(worker);
    const client = Comlink.wrap(lifecycle.endpoint);
    const rejected = assert.rejects(lifecycle.run(async () => {
      await client.init();
      return client;
    }, 1000, "Init"), { name: "AbortError" });
    assert.deepEqual([...worker.listeners].sort(), ["error", "message", "messageerror"]);
    assert.equal(worker.messages.length, 1);
    lifecycle.terminate();
    await rejected;
    assert.equal(worker.listeners.size, 0);
    // releaseProxy clears the proxy locally, without communicating with the
    // terminated native Worker or waiting for its RELEASE acknowledgement.
    client[Comlink.releaseProxy]();
    assert.equal(worker.messages.length, 1);
    assert.equal(worker.terminateCalls, 1);
  });
});
