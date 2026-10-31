/** Rows per page, shared by the Jobs tab's views; the largest is the default. */
export const PAGE_SIZES = [10, 25, 50] as const
const PAGE_SIZE_KEY = 'kickjs-devtools:jobs:page-size'

export function readPageSize(): number {
  try {
    const n = Number(localStorage.getItem(PAGE_SIZE_KEY))
    return (PAGE_SIZES as readonly number[]).includes(n) ? n : 50
  } catch {
    return 50 // storage unavailable
  }
}

export function savePageSize(n: number): void {
  try {
    localStorage.setItem(PAGE_SIZE_KEY, String(n))
  } catch {
    // storage unavailable — the choice lasts for this visit
  }
}

/** The last page's index for `total` rows; 0 when there are none. */
export const lastPageOf = (total: number, size: number): number =>
  Math.max(0, Math.ceil(total / size) - 1)

/** The rows on `page`, or on the last page if the list shrank under it. */
export function pageOf<T>(rows: readonly T[], page: number, size: number): T[] {
  const start = Math.min(page, lastPageOf(rows.length, size)) * size
  return rows.slice(start, start + size)
}

/** "1–50 of 137", or "0" for an empty page; `total` left out when unknown. */
export function rangeLabel(page: number, size: number, shown: number, total?: number): string {
  const range = shown ? `${page * size + 1}–${page * size + shown}` : '0'
  return total === undefined ? range : `${range} of ${total}`
}
