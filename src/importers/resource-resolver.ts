import * as THREE from "three";

function stripQueryAndFragment(value: string): string {
  return value.split(/[?#]/u, 1)[0] ?? value;
}

function decodePath(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizePath(value: string): string {
  const segments = value.replaceAll("\\", "/").split("/");
  const normalized: string[] = [];

  for (const segment of segments) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      normalized.pop();
      continue;
    }
    normalized.push(segment);
  }

  return normalized.join("/");
}

function isExternalResource(value: string): boolean {
  return /^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(value);
}

function relativePathOf(file: File): string {
  return normalizePath(file.webkitRelativePath || file.name);
}

export class LocalResourceResolver {
  readonly manager: THREE.LoadingManager;

  private readonly exactFiles = new Map<string, File | null>();
  private readonly basenameFiles = new Map<string, File | null>();
  private readonly objectUrls = new Map<File, string>();
  private readonly unresolved = new Set<string>();
  private readonly baseDirectory: string;

  constructor(files: readonly File[], primary?: File) {
    const primaryPath = primary ? relativePathOf(primary) : "";
    this.baseDirectory = primaryPath.includes("/")
      ? primaryPath.slice(0, primaryPath.lastIndexOf("/"))
      : "";

    for (const file of files) {
      const path = relativePathOf(file);
      const key = path.toLowerCase();
      const exact = this.exactFiles.get(key);
      this.exactFiles.set(
        key,
        exact === undefined || exact === file ? file : null,
      );

      const basename = path.split("/").at(-1)?.toLowerCase();
      if (!basename) {
        continue;
      }
      const existing = this.basenameFiles.get(basename);
      this.basenameFiles.set(
        basename,
        existing === undefined || existing === file ? file : null,
      );
    }

    this.manager = new THREE.LoadingManager();
    this.manager.setURLModifier((url) => this.resolve(url));
  }

  get unresolvedResources(): readonly string[] {
    return [...this.unresolved];
  }

  resolve(url: string): string {
    const canonicalUrl = url.replaceAll("\\", "/");
    if (/^(?:data|blob):/iu.test(canonicalUrl)) {
      return url;
    }

    const decodedPath = decodePath(stripQueryAndFragment(canonicalUrl));
    if (isExternalResource(decodedPath)) {
      this.unresolved.add(url);
      throw new Error(
        `External model resources are not loaded: ${url}. Select the referenced resource as a local file instead.`,
      );
    }

    const path = normalizePath(decodedPath);
    const lowerPath = path.toLowerCase();
    const basedPath = this.baseDirectory
      ? normalizePath(`${this.baseDirectory}/${decodedPath}`).toLowerCase()
      : lowerPath;
    const basename = lowerPath.split("/").at(-1);
    let file: File | null | undefined;
    for (const key of new Set([basedPath, lowerPath])) {
      if (this.exactFiles.has(key)) {
        file = this.exactFiles.get(key);
        break;
      }
    }
    if (file === undefined && basename) {
      file = this.basenameFiles.get(basename);
    }

    if (file === null) {
      this.unresolved.add(path || url);
      throw new Error(
        `Ambiguous local model resource: ${url}. Select files with their relative folders preserved.`,
      );
    }
    if (file === undefined) {
      this.unresolved.add(path || url);
      throw new Error(
        `Referenced local model resource was not selected: ${url}. Select it together with the model file.`,
      );
    }

    const existingUrl = this.objectUrls.get(file);
    if (existingUrl) {
      return existingUrl;
    }

    const objectUrl = URL.createObjectURL(file);
    this.objectUrls.set(file, objectUrl);
    return objectUrl;
  }

  dispose(): void {
    for (const objectUrl of this.objectUrls.values()) {
      URL.revokeObjectURL(objectUrl);
    }
    this.objectUrls.clear();
  }
}
