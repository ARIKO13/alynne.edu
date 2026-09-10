export interface Tier {
  level: number;
  name: string;
  emoji: string;
  xpRequired: number;
  xpToNext: number;
  exclusivity: string;
}

export const TIERS: Tier[] = [
  { level: 1, name: 'Apprentice',     emoji: '🌱', xpRequired: 0,     xpToNext: 500,  exclusivity: 'Semua user mulai di sini' },
  { level: 2, name: 'Scholar',       emoji: '📖', xpRequired: 500,   xpToNext: 1500, exclusivity: '~60% user capai ini' },
  { level: 3, name: 'Sage',          emoji: '🔮', xpRequired: 2000,  xpToNext: 4000, exclusivity: '~30% user' },
  { level: 4, name: 'Archmage',      emoji: '⚗️', xpRequired: 6000,  xpToNext: 9000, exclusivity: '~10% user' },
  { level: 5, name: 'Luminary',      emoji: '🌟', xpRequired: 15000, xpToNext: 20000, exclusivity: 'Top 3% — sangat bergengsi' },
  { level: 6, name: 'Eternal',       emoji: '👑', xpRequired: 35000, xpToNext: 999999, exclusivity: '< 1% user — ultimate flex' },
];

export function getTierForXP(xp: number): Tier {
  for (let i = TIERS.length - 1; i >= 0; i--) {
    if (xp >= TIERS[i].xpRequired) return TIERS[i];
  }
  return TIERS[0];
}

export function getXPProgress(xp: number, tier: Tier): number {
 const prev = tier.xpRequired;
  const next = tier.xpToNext + prev;
  if (tier.level === TIERS.length) return 100;
  return Math.min(100, Math.round(((xp - prev) / (next - prev)) * 100));
}

export function getXPToNextTier(xp: number, tier: Tier): number {
  if (tier.level === TIERS.length) return 0;
  return (tier.xpRequired + tier.xpToNext) - xp;
}
