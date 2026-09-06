const DATABASE = "render-viewer-3d-projects";
const KEY = "latest-v1";
const BINARY_RECORD = "rv3d-autosave-bytes-v1";
interface BinaryAutosave { format: typeof BINARY_RECORD; type: string; bytes: ArrayBuffer; }

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    let blocked = false;
    request.onupgradeneeded = () => request.result.createObjectStore("projects");
    request.onsuccess = () => {
      if (blocked) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error ?? new Error("Unable to open autosave database."));
    request.onblocked = () => { blocked = true; reject(new Error("Autosave database is blocked by another tab.")); };
  });
}

/** A request error bubbles before transaction.error is populated in WebKit.
 * Preserve its cause and wait for abort, so retries start after the failed write.
 */
function transact<T>(db: IDBDatabase, mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("projects", mode);
    let result: T;
    let requestError: DOMException | null = null;
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(requestError ?? tx.error ?? new Error("Autosave transaction aborted."));
    const request = operation(tx.objectStore("projects"));
    request.onsuccess = () => { result = request.result; };
    request.onerror = () => { requestError = request.error; };
    tx.onerror = () => { requestError ??= request.error ?? tx.error; };
  });
}

function isBlobStorageError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const cause = error as { name?: string; message?: string };
  return cause.name === "DataCloneError" ||
    (cause.name === "UnknownError" && /blob|file/i.test(cause.message ?? ""));
}

export async function writeAutosave(blob: Blob): Promise<void> {
  const db = await open();
  try {
    try {
      await transact(db, "readwrite", store => store.put(blob, KEY));
    } catch (error) {
      if (!isBlobStorageError(error)) throw error;
      // Some WebKit storage backends cannot prepare Blob/File records. ArrayBuffer
      // uses IndexedDB's portable binary structured clone without base64 expansion.
      const binary: BinaryAutosave = { format: BINARY_RECORD, type: blob.type, bytes: await blob.arrayBuffer() };
      await transact(db, "readwrite", store => store.put(binary, KEY));
    }
  } finally { db.close(); }
}

export async function readAutosave(): Promise<Blob | undefined> {
  const db = await open();
  try {
    const value: unknown = await transact(db, "readonly", store => store.get(KEY));
    if (value instanceof Blob) return value; // Existing autosaves remain readable.
    if (value && typeof value === "object") {
      const record = value as Partial<BinaryAutosave>;
      if (record.format === BINARY_RECORD && typeof record.type === "string" && record.bytes instanceof ArrayBuffer) {
        return new Blob([record.bytes], { type: record.type });
      }
    }
    return undefined;
  } finally { db.close(); }
}
