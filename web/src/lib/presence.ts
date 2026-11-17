export interface PresenceBar {
  a: number;
  b: number;
  open: boolean;
}

/** União dos intervalos dos MACs de um aparelho, sem duplicar tempo online. */
export function mergePresenceBars(intervals: PresenceBar[]): PresenceBar[] {
  const merged: PresenceBar[] = [];
  for (const bar of [...intervals].sort((a, b) => a.a - b.a)) {
    const previous = merged[merged.length - 1];
    if (previous && bar.a <= previous.b) {
      previous.b = Math.max(previous.b, bar.b);
      previous.open ||= bar.open;
    } else {
      merged.push({ ...bar });
    }
  }
  return merged;
}
