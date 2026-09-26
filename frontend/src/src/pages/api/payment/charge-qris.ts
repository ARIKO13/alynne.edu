import type { APIRoute } from 'astro';
import { getSession } from '@/lib/auth';
import { isAdmin } from '@/lib/admin';
import { subscriptionDb, PRICE_RP } from '@/lib/subscription-db';

const MIDTRANS_SERVER_KEY = 'Mid-server-6C-pAyE4y1jx_M0Gd-MqjauI';
const IS_PRODUCTION = true;
const MIDTRANS_API_URL = IS_PRODUCTION
  ? 'https://app.midtrans.com/v2/charge'
  : 'https://app.sandbox.midtrans.com/v2/charge';

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
      return Response.json({ error: 'Admin tidak perlu berlangganan' }, { status: 400 });
    }

    const subStatus = await subscriptionDb.getEffectiveStatus(userId);
    if (subStatus.status === 'active') {
      return Response.json({ error: 'Kamu sudah berlangganan aktif' }, { status: 400 });
    }

    const orderId = `SUB-${userId.slice(0, 8)}-${Date.now()}`;
    const authString = Buffer.from(MIDTRANS_SERVER_KEY + ':').toString('base64');

    const payload = {
      payment_type: 'qris',
      transaction_details: {
        order_id: orderId,
        gross_amount: PRICE_RP,
      },
      item_details: [
        {
          id: 'SUB-1M',
          price: PRICE_RP,
          quantity: 1,
          name: 'ALYNNE.EDU: Berlangganan 30 Hari',
          category: 'Digital Service',
          merchant_name: 'ALYNNE.EDU',
        },
      ],
      customer_details: {
        first_name: name,
        email: email,
      },
      callbacks: {
        notification: 'https://alynne.my.id/api/payment/notification',
      },
    };

    const res = await fetch(MIDTRANS_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Basic ${authString}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('[charge-qris] failed:', res.status, errText);
      return Response.json({ error: 'Gagal membuat pembayaran QRIS' }, { status: 500 });
    }

    const data = await res.json();
    console.log('[charge-qris] success:', data.transaction_id, data.status);

    // Extract QRIS URL
    const qrisUrl = data.actions?.[0]?.url || '';
    const transactionId = data.transaction_id || '';

    if (!qrisUrl) {
      console.error('[charge-qris] no QRIS URL in response:', JSON.stringify(data));
      return Response.json({ error: 'QRIS tidak tersedia' }, { status: 500 });
    }

    // Update subscription record with order ID
    const { d1 } = await import('@/lib/d1-client');
    const now = new Date().toISOString();
    await d1.execute(
      'UPDATE Subscription SET midtransOrderId = ?, updatedAt = ? WHERE userId = ?',
      [orderId, now, userId]
    );

    return Response.json({
      qrisUrl,
      orderId,
      transactionId,
    });
  } catch (error) {
    console.error('[charge-qris] error:', error);
    return Response.json({ error: 'Gagal membuat pembayaran' }, { status: 500 });
  }
};
