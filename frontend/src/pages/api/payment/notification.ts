import type { APIRoute } from 'astro';

/**
 * Payment endpoint stub.
 * Subscription table was dropped in schema migration (2026-09-26).
 * Will be reimplemented when new payment feature is built.
 */
export const POST: APIRoute = async () => {
  return Response.json(
    { error: 'Payment feature under reconstruction', code: 'PAYMENT_DISABLED' },
    { status: 503 }
  );
};

export const GET: APIRoute = async () => {
  return Response.json(
    { error: 'Payment feature under reconstruction', code: 'PAYMENT_DISABLED' },
    { status: 503 }
  );
};
