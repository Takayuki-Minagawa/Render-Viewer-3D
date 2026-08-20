import type * as THREE from "three";
import { abortable, throwIfImportAborted } from "./abort";

interface PendingWaiter {
  resolve: () => void;
  reject: (reason: Error) => void;
}

const resolverObjectUrls = new WeakMap<
  THREE.LoadingManager,
  Set<string>
>();

/** Marks Blob URLs that remain owned by LocalResourceResolver. */
export function registerLocalResourceObjectUrl(
  manager: THREE.LoadingManager,
  url: string,
): void {
  let urls = resolverObjectUrls.get(manager);
  if (!urls) {
    urls = new Set<string>();
    resolverObjectUrls.set(manager, urls);
  }
  urls.add(url);
}

class LoadingManagerResourceTracker {
  private pendingCount = 0;
  private readonly failedUrls = new Set<string>();
  private readonly loaderObjectUrls = new Set<string>();
  private readonly waiters = new Set<PendingWaiter>();
  private readonly originalItemStart: (url: string) => void;
  private readonly originalItemEnd: (url: string) => void;
  private readonly originalItemError: (url: string) => void;

  constructor(private readonly manager: THREE.LoadingManager) {
    this.originalItemStart = manager.itemStart;
    this.originalItemEnd = manager.itemEnd;
    this.originalItemError = manager.itemError;

    manager.itemStart = (url: string): void => {
      this.pendingCount += 1;
      this.originalItemStart.call(manager, url);
    };
    manager.itemEnd = (url: string): void => {
      try {
        this.originalItemEnd.call(manager, url);
      } finally {
        this.pendingCount = Math.max(0, this.pendingCount - 1);
        this.settleWaitersIfComplete();
      }
    };
    manager.itemError = (url: string): void => {
      this.failedUrls.add(url);
      this.originalItemError.call(manager, url);
    };
  }

  captureCreatedObjectUrls<T>(operation: () => T): T {
    const originalCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = (object: Blob | MediaSource): string => {
      const url = originalCreateObjectURL.call(URL, object);
      if (/^blob:/iu.test(url)) this.loaderObjectUrls.add(url);
      return url;
    };
    try {
      return operation();
    } finally {
      URL.createObjectURL = originalCreateObjectURL;
    }
  }

  waitForStartedResources(): Promise<void> {
    if (this.pendingCount === 0) {
      return this.failedUrls.size > 0
        ? Promise.reject(this.createResourceError())
        : Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      this.waiters.add({ resolve, reject });
    });
  }

  restore(): void {
    this.manager.itemStart = this.originalItemStart;
    this.manager.itemEnd = this.originalItemEnd;
    this.manager.itemError = this.originalItemError;
  }

  revokeLoaderObjectUrls(): void {
    for (const url of this.loaderObjectUrls) {
      if (resolverObjectUrls.get(this.manager)?.has(url)) {
        continue;
      }
      try {
        URL.revokeObjectURL(url);
      } catch {
        // Cleanup must not replace the parse, sidecar, or abort failure.
      }
    }
    this.loaderObjectUrls.clear();
  }

  private settleWaitersIfComplete(): void {
    if (this.pendingCount !== 0) return;

    const error =
      this.failedUrls.size > 0 ? this.createResourceError() : undefined;
    for (const waiter of this.waiters) {
      if (error) {
        waiter.reject(error);
      } else {
        waiter.resolve();
      }
    }
    this.waiters.clear();
  }

  private createResourceError(): Error {
    return new Error(
      `Failed to load local model sidecar resource${this.failedUrls.size === 1 ? "" : "s"}: ${[...this.failedUrls].join(", ")}. Ensure every referenced file is selected and readable.`,
    );
  }
}

/**
 * Runs a loader parse operation and keeps its URL-backed local resources alive
 * until every LoadingManager item started by that operation has settled.
 */
export async function parseWithLoaderResourceWait<T>(
  manager: THREE.LoadingManager,
  parse: () => T | Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const tracker = new LoadingManagerResourceTracker(manager);
  const abortManager = (): void => {
    manager.abort();
  };
  let result: T | undefined;
  let parseFailed = false;
  let parseFailure: unknown;

  try {
    throwIfImportAborted(signal);
    try {
      result = await abortable(
        Promise.resolve().then(() =>
          tracker.captureCreatedObjectUrls(parse),
        ),
        signal,
        abortManager,
      );
    } catch (error: unknown) {
      parseFailed = true;
      parseFailure = error;
    }

    let resourceFailed = false;
    let resourceFailure: unknown;
    if (!signal?.aborted) {
      try {
        await abortable(
          tracker.waitForStartedResources(),
          signal,
          abortManager,
        );
      } catch (error: unknown) {
        resourceFailed = true;
        resourceFailure = error;
      }
    }

    throwIfImportAborted(signal);
    if (parseFailed) throw parseFailure;
    if (resourceFailed) throw resourceFailure;
    return result as T;
  } finally {
    tracker.restore();
    tracker.revokeLoaderObjectUrls();
  }
}

function disposeOnce(resource: unknown, disposed: Set<object>): void {
  if (
    typeof resource !== "object" ||
    resource === null ||
    disposed.has(resource)
  ) {
    return;
  }

  const candidate = resource as { dispose?: () => void };
  if (typeof candidate.dispose !== "function") return;
  disposed.add(resource);
  try {
    candidate.dispose();
  } catch {
    // Cleanup must never replace the parse, resource, abort, or budget error.
  }
}

function closeImageOnce(image: unknown, closed: Set<object>): void {
  const pending: unknown[] = [image];
  while (pending.length > 0) {
    const current = pending.pop();
    if (Array.isArray(current)) {
      for (const item of current) pending.push(item);
      continue;
    }
    if (
      typeof current !== "object" ||
      current === null ||
      closed.has(current)
    ) {
      continue;
    }
    closed.add(current);
    const close = (current as { close?: unknown }).close;
    if (typeof close === "function") {
      try {
        close.call(current);
      } catch {
        // Cleanup is best-effort and must preserve the original failure.
      }
    }
  }
}

function disposeTexture(
  texture: THREE.Texture,
  disposed: Set<object>,
  closedImages: Set<object>,
): void {
  closeImageOnce(texture.image, closedImages);
  closeImageOnce(texture.source.data, closedImages);
  disposeOnce(texture, disposed);
}

function disposeMaterialResources(
  material: THREE.Material,
  disposed: Set<object>,
  closedImages: Set<object>,
): void {
  for (const value of Object.values(material)) {
    if ((value as { isTexture?: boolean } | null)?.isTexture) {
      disposeTexture(value as THREE.Texture, disposed, closedImages);
    }
  }

  const uniforms = (material as THREE.Material & {
    uniforms?: Record<string, { value?: unknown }>;
  }).uniforms;
  for (const uniform of Object.values(uniforms ?? {})) {
    const values = Array.isArray(uniform.value)
      ? uniform.value
      : [uniform.value];
    for (const value of values) {
      if ((value as { isTexture?: boolean } | null)?.isTexture) {
        disposeTexture(value as THREE.Texture, disposed, closedImages);
      }
    }
  }

  disposeOnce(material, disposed);
}

/** Disposes a parsed-but-unpublished Three.js tree after an import failure. */
export function disposeLoadedObject(root: THREE.Object3D): void {
  const disposed = new Set<object>();
  const closedImages = new Set<object>();

  const visited = new Set<THREE.Object3D>();
  const pending: THREE.Object3D[] = [root];
  while (pending.length > 0) {
    const object = pending.pop()!;
    if (visited.has(object)) continue;
    visited.add(object);

    const renderable = object as THREE.Object3D & {
      geometry?: { dispose?: () => void };
      material?: THREE.Material | readonly THREE.Material[];
    };
    disposeOnce(renderable.geometry, disposed);

    const materials = Array.isArray(renderable.material)
      ? renderable.material
      : [renderable.material];
    for (const material of materials) {
      if (material) {
        disposeMaterialResources(material, disposed, closedImages);
      }
    }

    const skinned = object as THREE.Object3D & {
      isSkinnedMesh?: boolean;
      skeleton?: THREE.Skeleton;
    };
    if (skinned.isSkinnedMesh && skinned.skeleton) {
      if (skinned.skeleton.boneTexture) {
        disposeTexture(
          skinned.skeleton.boneTexture,
          disposed,
          closedImages,
        );
        skinned.skeleton.boneTexture = null;
      }
      disposeOnce(skinned.skeleton, disposed);
    }

    const instanced = object as THREE.Object3D & {
      isInstancedMesh?: boolean;
      morphTexture?: THREE.DataTexture | null;
      dispose?: () => void;
    };
    if (instanced.isInstancedMesh) {
      if (instanced.morphTexture) {
        disposeTexture(instanced.morphTexture, disposed, closedImages);
        instanced.morphTexture = null;
      }
      disposeOnce(instanced, disposed);
    }

    const light = object as THREE.Object3D & {
      isLight?: boolean;
      dispose?: () => void;
    };
    if (light.isLight) disposeOnce(light, disposed);

    for (let index = object.children.length - 1; index >= 0; index -= 1) {
      pending.push(object.children[index]);
    }
  }
}
