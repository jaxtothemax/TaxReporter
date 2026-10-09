/** Code-unit order: the same on every machine, unlike `localeCompare`. */
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
