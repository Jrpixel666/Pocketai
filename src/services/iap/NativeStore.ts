import type {Binding} from './iapWire';
import type {
  PurchaseOutcome,
  StorePort,
  StoreProduct,
  StoreQuery,
  StoreTransaction,
} from './StorePort';

// This build ships without an app store connection, so the store always
// reports itself unavailable and every purchase path stays dormant.
export class NativeStore implements StorePort {
  async init(): Promise<boolean> {
    return false;
  }

  async fetchProducts(_productIds: string[]): Promise<StoreProduct[]> {
    return [];
  }

  async storefront(): Promise<string | undefined> {
    return undefined;
  }

  async purchase(
    _productId: string,
    _binding: Binding | null,
  ): Promise<PurchaseOutcome> {
    return {kind: 'error', code: 'unavailable'};
  }

  async unfinished(): Promise<StoreTransaction[]> {
    return [];
  }

  async currentEntitlements(): Promise<StoreQuery> {
    return {ok: false, transactions: []};
  }

  async sync(): Promise<void> {}

  async finish(_tx: StoreTransaction): Promise<void> {}

  onTransaction(_listener: (tx: StoreTransaction) => void): () => void {
    return () => {};
  }
}
