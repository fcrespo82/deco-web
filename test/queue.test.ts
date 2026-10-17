import { describe, expect, it } from "vitest";
import { SerialQueue } from "../src/core/queue.js";

const tick = (ms = 1) => new Promise((r) => setTimeout(r, ms));

describe("SerialQueue", () => {
  it("nunca roda duas tarefas ao mesmo tempo e respeita a ordem", async () => {
    const q = new SerialQueue();
    let running = 0;
    let maxRunning = 0;
    const order: number[] = [];

    await Promise.all(
      [5, 1, 3, 0, 2].map((delay, i) =>
        q.run(async () => {
          running += 1;
          maxRunning = Math.max(maxRunning, running);
          await tick(delay);
          order.push(i);
          running -= 1;
        }),
      ),
    );

    expect(maxRunning).toBe(1);
    expect(order).toEqual([0, 1, 2, 3, 4]);
  });

  it("uma falha não trava a fila nem afeta as próximas", async () => {
    const q = new SerialQueue();
    const first = q.run(async () => {
      throw new Error("boom");
    });
    const second = q.run(async () => "ok");
    await expect(first).rejects.toThrow("boom");
    await expect(second).resolves.toBe("ok");
  });

  it("informa o tamanho da fila", async () => {
    const q = new SerialQueue();
    let release!: () => void;
    const blocker = q.run(() => new Promise<void>((r) => (release = r)));
    const next = q.run(async () => undefined);
    await tick();
    expect(q.size).toBe(2);
    release();
    await Promise.all([blocker, next]);
    expect(q.size).toBe(0);
  });
});
