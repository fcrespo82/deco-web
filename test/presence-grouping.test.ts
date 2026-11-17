import { describe, expect, it } from "vitest";
import { mergePresenceBars } from "../web/src/lib/presence.js";

describe("presença de MACs unidos", () => {
  it("une sobreposições e intervalos contíguos sem somar tempo duplicado", () => {
    const bars = [
      { a: 20, b: 40, open: false },
      { a: 10, b: 30, open: false },
      { a: 40, b: 50, open: true },
      { a: 60, b: 70, open: false },
    ];
    expect(mergePresenceBars(bars)).toEqual([
      { a: 10, b: 50, open: true },
      { a: 60, b: 70, open: false },
    ]);
    expect(bars[1]).toEqual({ a: 10, b: 30, open: false });
  });
  it("aceita um aparelho sem intervalos", () => {
    expect(mergePresenceBars([])).toEqual([]);
  });
});
