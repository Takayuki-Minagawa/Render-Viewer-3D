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
  const segments = decodePath(stripQueryAndFragment(value))
    .replaceAll("\\", "/")
    .split("/");
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

  private readonly exactFiles = new Map<string, File>();
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
      this.exactFiles.set(path.toLowerCase(), file);

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
    if (/^data:/iu.test(url)) {
      return url;
    }

    if (isExternalResource(url)) {
      this.unresolved.add(url);
      throw new Error(
        `External model resources are not loaded: ${url}. Select the referenced resource as a local file instead.`,
      );
    }

    const path = normalizePath(url);
    const lowerPath = path.toLowerCase();
    const basedPath = this.baseDirectory
      ? normalizePath(`${this.baseDirectory}/${path}`).toLowerCase()
      : lowerPath;
    const basename = lowerPath.split("/").at(-1);
    const file =
      this.exactFiles.get(basedPath) ??
      this.exactFiles.get(lowerPath) ??
      (basename ? this.basenameFiles.get(basename) : undefined);

    if (!file) {
      if (path) {
        this.unresolved.add(path);
      }
      return url;
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
