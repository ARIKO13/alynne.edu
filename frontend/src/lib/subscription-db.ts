/**
 * Subscription DB - stubbed.
 * Old Subscription table was dropped in schema migration (2026-09-26).
 * User table now has activeSubscription + packetSubscription columns.
 * Will be reimplemented when new payment feature is built.
 */

export const SUBSCRIPTION_DAYS = 30;

export interface Subscription {
  id: string;
  userId: string;
  status: string;
  plan?: string;
  trialEndsAt?: string;
}

class StubSubscriptionDb {
  async findByUserId(userId: string): Promise<Subscription | null> {
    // TODO: query User table for activeSubscription + packetSubscription
    return null;
  }
  async createTrial(userId: string): Promise<Subscription> {
    return {
      id: 'stub-' + Date.now(),
      userId,
      status: 'trial',
    };
  }
  async findByOrderId(_orderId: string): Promise<Subscription | null> {
    return null;
  }
  async activate(_userId: string, _orderId: string, _transactionId: string): Promise<void> {}
  async expire(_userId: string): Promise<void> {}
}

export const subscriptionDb = new StubSubscriptionDb();
