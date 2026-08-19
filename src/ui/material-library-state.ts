export type MaterialSupportStatus = "direct" | "approximate" | "stored";

export type MaterialSupportFilter = "all" | MaterialSupportStatus;

export interface MaterialLibraryFilters {
  readonly query: string;
  readonly category: string;
  readonly support: MaterialSupportFilter;
}

export interface MaterialLibraryItem {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly tags: readonly string[];
  readonly keywords: readonly string[];
  readonly support: MaterialSupportStatus;
}

export const DEFAULT_MATERIAL_LIBRARY_FILTERS: Readonly<MaterialLibraryFilters> =
  Object.freeze({
    query: "",
    category: "all",
    support: "all",
  });

export function filterMaterialLibraryItems<T extends MaterialLibraryItem>(
  items: readonly T[],
  filters: MaterialLibraryFilters,
  locale: "ja" | "en",
): T[] {
  const queryTokens = normalizeSearchText(filters.query)
    .split(" ")
    .filter(Boolean);

  return items
    .filter((item) => {
      if (filters.category !== "all" && item.category !== filters.category) {
        return false;
      }
      if (filters.support !== "all" && item.support !== filters.support) {
        return false;
      }
      if (queryTokens.length === 0) return true;

      const searchText = normalizeSearchText(
        [item.name, item.category, ...item.tags, ...item.keywords].join(" "),
      );
      return queryTokens.every((token) => searchText.includes(token));
    })
    .sort((left, right) =>
      left.name.localeCompare(right.name, locale, {
        numeric: true,
        sensitivity: "base",
      }),
    );
}

export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s_-]+/g, " ")
    .trim();
}

export function countMaterialUsage(
  materialId: string,
  materialIds: readonly string[],
): number {
  return materialIds.reduce(
    (count, candidate) => count + Number(candidate === materialId),
    0,
  );
}
