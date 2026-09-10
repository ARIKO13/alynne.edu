import type { APIRoute } from 'astro';
import { getSession } from '@/lib/auth';
import { isAdmin } from '@/lib/admin';
import { subscriptionDb } from '@/lib/subscription-db';

export const GET: APIRoute = async ({ request }) => {
  try {
    const session = await getSession(request);
    if (!session?.user?.id) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const email = session.user.email || '';
    const userId = session.user.id;

    // Admins always have access
    if (isAdmin(email)) {
      return Response.json({
        hasAccess: true,
        isAdmin: true,
        status: 'active',
        daysRemaining: 999,
        trialEndsAt: null,
        expiresAt: null,
      });
    }

    const subStatus = await subscriptionDb.getEffectiveStatus(userId);

    const hasAccess = subStatus.status === 'trial' || subStatus.status === 'active';

    return Response.json({
      hasAccess,
      isAdmin: false,
      status: subStatus.status,
      daysRemaining: subStatus.daysRemaining,
      trialEndsAt: subStatus.trialEndsAt,
      expiresAt: subStatus.expiresAt,
    });
  } catch (error) {
    console.error('[subscription] error:', error);
    // On error, allow access (fail-open so users aren't locked out)
    return Response.json({ hasAccess: true, status: 'unknown', daysRemaining: 0, isAdmin: false });
  }
};
