/**
 * Fila serial: no máximo uma tarefa rodando por vez, em ordem de chegada.
 * Toda chamada ao Deco passa por uma única instância — o firmware tem uma só
 * sessão e chamadas paralelas se atropelam.
 */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private waiting = 0;
  private active = false;

  /** Tarefas na fila, incluindo a que está rodando. */
  get size(): number {
    return this.waiting + (this.active ? 1 : 0);
  }

  run<T>(task: () => Promise<T>): Promise<T> {
    this.waiting += 1;
    const start = async () => {
      this.waiting -= 1;
      this.active = true;
      try {
        return await task();
      } finally {
        this.active = false;
      }
    };
    const result = this.tail.then(start, start);
    // A fila segue mesmo se a tarefa falhar, sem vazar a rejeição adiante.
    this.tail = result.catch(() => undefined);
    return result;
  }
}
