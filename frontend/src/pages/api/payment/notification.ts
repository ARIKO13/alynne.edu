import type { APIRoute } from 'astro';
import { verifyWebhookSignature } from '@/lib/midtrans';
import { subscriptionDb, SUBSCRIPTION_DAYS } from '@/lib/subscription-db';
import { d1 } from '@/lib/d1-client';

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    console.log('[webhook] received notification:', JSON.stringify(body));

    const { order_id, transaction_status, transaction_id, fraud_status, status_code, gross_amount, signature_key } = body;

    // Verify signature
    if (!signature_key || !verifyWebhookSignature(order_id, String(status_code), String(gross_amount), signature_key)) {
      console.error('[webhook] invalid signature for order:', order_id);
      return Response.json({ error: 'Invalid signature' }, { status: 403 });
    }

    // Find subscription by order ID
    const sub = await subscriptionDb.findByOrderId(order_id);
    if (!sub) {
      console.error('[webhook] subscription not found for order:', order_id);
      return Response.json({ error: 'Not found' }, { status: 404 });
    }

    const now = new Date().toISOString();

    // Handle different transaction statuses
    if (transaction_status === 'capture' || transaction_status === 'settlement') {
      // Payment successful
      const expiresAt = new Date(Date.now() + SUBSCRIPTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
      await d1.execute(
        `UPDATE Subscription 
         SET status = 'active', paidAt = ?, expiresAt = ?, midtransTransactionId = ?, updatedAt = ?
         WHERE userId = ?`,
        [now, expiresAt, transaction_id || '', now, sub.userId]
      );
      console.log('[webhook] subscription ACTIVATED for userId:', sub.userId);
    } else if (transaction_status === 'pending') {
      console.log('[webhook] payment pending for order:', order_id);
    } else if (transaction_status === 'deny' || transaction_status === 'expire' || transaction_status === 'cancel') {
      // Payment failed/expired - don't change status, user can retry
      console.log('[webhook] payment failed/expired:', transaction_status, 'order:', order_id);
    }

    // Midtrans expects status 200
    return Response.json({ status: 'ok' });
  } catch (error) {
    console.error('[webhook] error:', error);
    return Response.json({ status: 'ok' });
  }
};
