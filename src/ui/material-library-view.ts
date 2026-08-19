import { MaterialLibraryView as MaterialLibraryViewBase } from "./material-library-view-base";

export {
  MATERIAL_PRESET_CHOICES,
  collectMaterialKeywords,
  filterCapabilities,
  getMaterialSupportStatus,
  resolveCapabilityValue,
  type MaterialEditorTab,
  type MaterialObjectAssignment,
  type MaterialPreviewField,
} from "./material-library-view-base";

/** Keeps newly created, duplicated, or individualized materials in view. */
export class MaterialLibraryView extends MaterialLibraryViewBase {
  readonly #root: HTMLElement;
  #knownMaterialIds = new Set<string>();
  #hasRendered = false;

  constructor(root: HTMLElement) {
    super(root);
    this.#root = root;
  }

  override render(
    ...args: Parameters<MaterialLibraryViewBase["render"]>
  ): void {
    const materials = args[0];
    const addedMaterial = this.#hasRendered
      ? materials.find((material) => !this.#knownMaterialIds.has(material.id))
      : undefined;

    super.render(...args);
    this.#knownMaterialIds = new Set(materials.map(({ id }) => id));
    this.#hasRendered = true;

    if (addedMaterial && this.isOpen) {
      super.open(addedMaterial.id);
      queueMicrotask(() =>
        this.#root
          .querySelector<HTMLInputElement>("[data-rename-material]")
          ?.focus(),
      );
    }
  }
}
