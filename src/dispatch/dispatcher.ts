import { DispatchRequest, DispatchResult } from "../core/types.js";

export interface Dispatcher {
  name: string;
  canHandle(): boolean;
  dispatch(request: DispatchRequest): Promise<DispatchResult>;
}

export class DispatchRouter {
  constructor(private readonly dispatchers: Dispatcher[]) {}

  choose(): Dispatcher {
    const available = this.dispatchers.find((dispatcher) => dispatcher.canHandle());
    if (!available) {
      throw new Error("No dispatcher is available in the current runtime.");
    }
    return available;
  }
}