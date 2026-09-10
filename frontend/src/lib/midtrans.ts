/**
 * Midtrans API Helper
 * Server-side only — never expose Server Key to client.
 */
import crypto from 'crypto';

const MIDTRANS_SERVER_KEY = 'Mid-server-6C-pAyE4y1jx_M0Gd-MqjauI';
const MIDTRANS_MERCHANT_ID = 'M344504433';

// Set true for Sandbox, false for Production
const IS_SANDBOX = false;
const MIDTRANS_BASE_URL = IS_SANDBOX
  ? 'https://app.sandbox.midtrans.com/snap/v1'
  : 'https://app.midtrans.com/snap/v1';

export interface CreateTransactionParams {
  orderId: string;
  amount: number;
  customerName: string;
  customerEmail: string;
  userId: string;
}

export interface MidtransSnapResponse {
  token: string;
  redirect_url: string;
}

/**
 * Create a Snap transaction — returns snap_token + redirect_url.
 */
export async function createSnapTransaction(params: CreateTransactionParams): Promise<MidtransSnapResponse> {
  const authString = Buffer.from(MIDTRANS_SERVER_KEY + ':').toString('base64');

  const payload = {
    transaction_details: {
      order_id: params.orderId,
      gross_amount: params.amount,
    },
    item_details: [
      {
        id: 'SUB-1M',
        price: params.amount,
        quantity: 1,
        name: 'ALYNNE.EDU - Berlangganan 30 Hari',
        category: 'Digital Service',
        merchant_name: 'ALYNNE.EDU',
      },
    ],
    customer_details: {
      first_name: params.customerName,
      email: params.customerEmail,
      user_id: params.userId,
    },
    callbacks: {
      notification: 'https://alynne.my.id/api/payment/notification',
      finish: 'https://alynne.my.id/?payment=success',
      error: 'https://alynne.my.id/?payment=error',
      pending: 'https://alynne.my.id/?payment=pending',
    },
    enabled_payments: [
    'gopay', 'qris', 'shopeepay',
    'bca_va', 'bni_va', 'bri_va', 'permata_va',
    'bank_transfer',
    'indomaret', 'alfamart',
  ],
  expiry: {
      unit: 'hours',
      duration: 24,
    },
  };

  const res = await fetch(`${MIDTRANS_BASE_URL}/transactions`, {
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
    console.error('[midtrans] create transaction failed:', res.status, errText);
    throw new Error(`Midtrans API error: ${res.status}`);
  }

  return res.json() as Promise<MidtransSnapResponse>;
}

/**
 * Verify webhook signature — Midtrans sends this with every notification.
 */
export function verifyWebhookSignature(
  orderId: string,
  statusCode: string,
  grossAmount: string,
  signatureKey: string
): boolean {
  const hash = crypto
    .createHash('sha512')
    .update(orderId + statusCode + grossAmount + MIDTRANS_SERVER_KEY)
    .digest('hex');
  return hash === signatureKey;
}

export { MIDTRANS_MERCHANT_ID, IS_SANDBOX };
