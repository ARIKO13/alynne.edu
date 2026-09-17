/**
 * Subscription DB layer — D1 via HTTP API
 */

import { d1 } from './d1-client';

export interface Subscription {
  id: string;
  userId: string;
  status: 'trial' | 'active' | 'expired' | 'cancelled';
  trialStartsAt: string;
  trialEndsAt: string;
  paidAt: string | null;
  expiresAt: string | null;
  midtransOrderId: string | null;
  midtransTransactionId: string | null;
  amount: number;
  createdAt: string;
  updatedAt: string;
}

export const TRIAL_DAYS = 7;
export const SUBSCRIPTION_DAYS = 30;
export const PRICE_RP = 69000;

export const subscriptionDb = {
  /**
   * Get subscription by userId
   */
  async findByUserId(userId: string): Promise<Subscription | null> {
    const rows = await d1.query<Subscription>(
      'SELECT * FROM Subscription WHERE userId = ?',
      [userId]
    );
    return rows[0] ?? null;
  },

  /**
   * Create a new trial subscription for a user
   */
  async createTrial(userId: string): Promise<Subscription> {
    const id = crypto.randomUUID();
    const now = new Date();
    const trialEnd = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
    const nowISO = now.toISOString();

    await d1.execute(
      `INSERT INTO Subscription (id, userId, status, trialStartsAt, trialEndsAt, paidAt, expiresAt, midtransOrderId, midtransTransactionId, amount, createdAt, updatedAt)
       VALUES (?, ?, 'trial', ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?)`,
      [id, userId, nowISO, trialEnd.toISOString(), PRICE_RP, nowISO, nowISO]
    );

    const rows = await d1.query<Subscription>(
      'SELECT * FROM Subscription WHERE id = ?', [id]
    );
    return rows[0]!;
  },

  /**
   * Update subscription status after successful payment
   */
  async activate(
    userId: string,
    orderId: string,
    transactionId: string,
    paidAt: string
  ): Promise<void> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SUBSCRIPTION_DAYS * 24 * 60 * 60 * 1000);
    const nowISO = now.toISOString();

    await d1.execute(
      `UPDATE Subscription 
       SET status = 'active', paidAt = ?, expiresAt = ?, midtransOrderId = ?, midtransTransactionId = ?, updatedAt = ?
       WHERE userId = ?`,
      [paidAt, expiresAt.toISOString(), orderId, transactionId, nowISO, userId]
    );
  },

  /**
   * Mark subscription as expired (run periodically or on check)
   */
  async expireIfDue(userId: string): Promise<void> {
    const sub = await this.findByUserId(userId);
    if (!sub) return;

    const now = new Date();
    if (sub.status === 'trial' && new Date(sub.trialEndsAt) < now) {
      await d1.execute(
        "UPDATE Subscription SET status = 'expired', updatedAt = ? WHERE userId = ?",
        [now.toISOString(), userId]
      );
    } else if (sub.status === 'active' && sub.expiresAt && new Date(sub.expiresAt) < now) {
      await d1.execute(
        "UPDATE Subscription SET status = 'expired', updatedAt = ? WHERE userId = ?",
        [now.toISOString(), userId]
      );
    }
  },

  /**
   * Get effective status — checks expiry and returns current state
   */
  async getEffectiveStatus(userId: string): Promise<{
    status: 'trial' | 'active' | 'expired' | 'none';
    trialEndsAt: string | null;
    expiresAt: string | null;
    daysRemaining: number;
  }> {
    await this.expireIfDue(userId);
    const sub = await this.findByUserId(userId);

    if (!sub) {
      return { status: 'none', trialEndsAt: null, expiresAt: null, daysRemaining: 0 };
    }

    const now = new Date();
    let daysRemaining = 0;

    if (sub.status === 'trial') {
      const endDate = new Date(sub.trialEndsAt);
      daysRemaining = Math.max(0, Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
    } else if (sub.status === 'active' && sub.expiresAt) {
      const endDate = new Date(sub.expiresAt);
      daysRemaining = Math.max(0, Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
    }

    return {
      status: sub.status,
      trialEndsAt: sub.trialEndsAt,
      expiresAt: sub.expiresAt,
      daysRemaining,
    };
  },

  /**
   * Find subscription by Midtrans order ID
   */
  async findByOrderId(orderId: string): Promise<Subscription | null> {
    const rows = await d1.query<Subscription>(
      'SELECT * FROM Subscription WHERE midtransOrderId = ?',
      [orderId]
    );
    return rows[0] ?? null;
  },
};
