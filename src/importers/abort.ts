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

  throwIfImportAborted(signal);

  return new Promise<T>((resolve, reject) => {
    const handleAbort = (): void => {
      onAbort?.();
      reject(
        signal.reason ??
          new DOMException("The model import was aborted.", "AbortError"),
      );
    };

    signal.addEventListener("abort", handleAbort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", handleAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", handleAbort);
        reject(error);
      },
    );
  });
}
