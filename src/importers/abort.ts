export function throwIfImportAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) {
    return;
  }

  if (signal.reason !== undefined) {
    throw signal.reason;
  }

  throw new DOMException("The model import was aborted.", "AbortError");
}

export async function abortable<T>(
  operation: Promise<T>,
  signal?: AbortSignal,
  onAbort?: () => void,
): Promise<T> {
  if (!signal) {
    return operation;
  }

  if (signal.aborted) {
    onAbort?.();
    throwIfImportAborted(signal);
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => {
      signal.removeEventListener("abort", handleAbort);
    };
    const handleAbort = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      onAbort?.();
      reject(
        signal.reason ??
          new DOMException("The model import was aborted.", "AbortError"),
      );
    };

    signal.addEventListener("abort", handleAbort, { once: true });
    if (signal.aborted) handleAbort();

    operation.then(
      (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      },
    );
  });
}
