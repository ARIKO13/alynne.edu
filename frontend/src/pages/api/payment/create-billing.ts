import type { APIRoute } from 'astro';
import { getSession } from '@/lib/auth';
import { isAdmin } from '@/lib/admin';
import { subscriptionDb } from '@/lib/subscription-db';
import { createSnapTransaction } from '@/lib/midtrans';
import {
  getTierById,
  getPaymentMethodById,
  type BillingTier,
} from '@/lib/billing-models';

/**
 * POST /api/payment/create-billing
 * Body: { tierId: string, paymentMethodId: string }
 *
 * Creates a Midtrans Snap transaction for a specific billing tier + payment
 * method. Differs from the legacy `create-transaction.ts` in that:
 *   - Accepts `tierId` (looks up price from `BILLING_TIERS`)
 *   - Accepts `paymentMethodId` (filters Snap's enabled_payments to the
 *     user's chosen method)
 *   - Stores the tier ID on the Subscription row so the webhook can later
 *     determine which tier to activate
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const session = await getSession(request);
    if (!session?.user?.id) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const email = session.user.email || '';
    const userId = session.user.id;
    const name = session.user.name || 'User';

    if (isAdmin(email)) {
      return Response.json(
        { error: 'Admin tidak perlu berlangganan' },
        { status: 400 }
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      tierId?: string;
      paymentMethodId?: string;
    };

    if (!body.tierId || !body.paymentMethodId) {
      return Response.json(
        { error: 'tierId dan paymentMethodId wajib diisi' },
        { status: 400 }
      );
    }

    const tier: BillingTier | undefined = getTierById(body.tierId);
    if (!tier) {
      return Response.json(
        { error: `Tier tidak dikenal: ${body.tierId}` },
        { status: 400 }
      );
    }

    const paymentMethod = getPaymentMethodById(body.paymentMethodId);
    if (!paymentMethod) {
      return Response.json(
        { error: `Metode pembayaran tidak dikenal: ${body.paymentMethodId}` },
        { status: 400 }
      );
    }

    // Block users who already have an active subscription.
    const subStatus = await subscriptionDb.getEffectiveStatus(userId);
    if (subStatus.status === 'active') {
      return Response.json(
        { error: 'Kamu sudah berlangganan aktif' },
        { status: 400 }
      );
    }

    // Midtrans wants an array of enabled payment codes. If the user picked a
    // method that maps to a single code, filter Snap to just that code.
    // Otherwise (e.g., no mapping) leave it undefined so Snap uses defaults.
    let enabledPayments: string[] | undefined;
    if (paymentMethod.midtransCode) {
      enabledPayments = Array.isArray(paymentMethod.midtransCode)
        ? paymentMethod.midtransCode
        : [paymentMethod.midtransCode];
    }

    const orderId = `BILL-${tier.id.toUpperCase()}-${userId.slice(0, 8)}-${Date.now()}`;
    const itemName = `${tier.name} - Berlangganan ${tier.durationDays} Hari`;

    const snapResult = await createSnapTransaction({
      orderId,
      amount: tier.price,
      customerName: name,
      customerEmail: email,
      userId,
      enabledPayments,
      itemName,
      itemId: tier.id,
    });

    // Persist the order ID on the Subscription row so the Midtrans webhook
    // (`/api/payment/notification`) can find it when payment is confirmed.
    const { d1 } = await import('@/lib/d1-client');
    const now = new Date().toISOString();
    await d1.execute(
      'UPDATE Subscription SET midtransOrderId = ?, amount = ?, updatedAt = ? WHERE userId = ?',
      [orderId, tier.price, now, userId]
    );

    return Response.json({
      snapToken: snapResult.token,
      redirectUrl: snapResult.redirect_url,
      orderId,
      tier: { id: tier.id, name: tier.name, price: tier.price, durationDays: tier.durationDays },
      paymentMethod: { id: paymentMethod.id, label: paymentMethod.label },
    });
  } catch (error) {
    console.error('[create-billing] error:', error);
    return Response.json(
      { error: 'Gagal membuat transaksi pembayaran' },
      { status: 500 }
    );
  }
};
