import type { APIRoute } from 'astro';
import { getSession } from '@/lib/auth';
import { isAdmin } from '@/lib/admin';
import { subscriptionDb, PRICE_RP } from '@/lib/subscription-db';
import { createSnapTransaction } from '@/lib/midtrans';

export const POST: APIRoute = async ({ request }) => {
  try {
    const session = await getSession(request);
    if (!session?.user?.id) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const email = session.user.email || '';
    const userId = session.user.id;
    const name = session.user.name || 'User';

    // Admins shouldn't need to pay
    if (isAdmin(email)) {
      return Response.json({ error: 'Admin tidak perlu berlangganan' }, { status: 400 });
    }

    // Check current subscription
    const subStatus = await subscriptionDb.getEffectiveStatus(userId);
    if (subStatus.status === 'active') {
      return Response.json({ error: 'Kamu sudah berlangganan aktif' }, { status: 400 });
    }

    // Generate order ID
    const orderId = `SUB-${userId.slice(0, 8)}-${Date.now()}`;

    // Create Midtrans transaction
    const snapResult = await createSnapTransaction({
      orderId,
      amount: PRICE_RP,
      customerName: name,
      customerEmail: email,
      userId,
    });

    // Update subscription record with order ID
    const { d1 } = await import('@/lib/d1-client');
    const now = new Date().toISOString();
    await d1.execute(
      'UPDATE Subscription SET midtransOrderId = ?, updatedAt = ? WHERE userId = ?',
      [orderId, now, userId]
    );

    return Response.json({
      snapToken: snapResult.token,
      redirectUrl: snapResult.redirect_url,
    });
  } catch (error) {
    console.error('[create-transaction] error:', error);
    return Response.json({ error: 'Gagal membuat transaksi' }, { status: 500 });
  }
};
