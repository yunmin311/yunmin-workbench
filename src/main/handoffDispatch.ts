/** Process-local idempotency: the same intent id can never start two sends. */
export class HandoffDispatchRegistry<T> {
  private requests = new Map<string, Promise<T>>();

  run(intentId: string, dispatch: () => Promise<T>): Promise<T> {
    const existing = this.requests.get(intentId);
    if (existing) return existing;
    const request = dispatch();
    this.requests.set(intentId, request);
    return request;
  }
}
