export class SerializedLatestOperation {
  private generation = 0;
  private queue: Promise<void> = Promise.resolve();

  invalidate(): void {
    this.generation += 1;
  }

  schedule(operation: (isCurrent: () => boolean) => Promise<void>): Promise<void> {
    const generation = ++this.generation;
    const isCurrent = () => generation === this.generation;
    const pending = this.queue.catch(() => undefined).then(async () => {
      if (isCurrent()) await operation(isCurrent);
    });
    this.queue = pending;
    return pending;
  }

  invalidateAndWait(operation: () => Promise<void>): Promise<void> {
    this.invalidate();
    const pending = this.queue.catch(() => undefined).then(operation);
    this.queue = pending;
    return pending;
  }
}
