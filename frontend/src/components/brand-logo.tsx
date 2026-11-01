/**
 * BrandLogo.tsx  -  Composed brand mark: Monitor + Mic (lucide icons)
 *
 * Replaces the old /alynne-ai-logo.png raster asset with a vector icon
 * composition so it scales crisply at any size and matches the violet
 * brand color across the app.
 *
 * Visual: a Monitor (rectangle with stand) as the base, with a small Mic
 * badge pinned to the bottom-right corner  -  like a "recording indicator".
 * Echoes the product's core value (monitor screen + voice input).
 */

import { Monitor, Mic } from 'lucide-react';

interface BrandLogoProps {
  /** Pixel size of the logo (width = height = size). */
  size?: number;
  /** Extra className for the outer container. */
  className?: string;
  /** Override brand color (defaults to violet #D9A87E). */
  color?: string;
}

export function BrandLogo({ size = 32, className = '', color = '#D9A87E' }: BrandLogoProps) {
  return (
    <div
      className={`relative inline-flex items-center justify-center ${className}`}
      style={{ width: size, height: size }}
      aria-label="ALYNNE AI"
      role="img"
    >
      {/* Monitor base  -  fills the whole box */}
      <Monitor
        className="h-full w-full"
        style={{ color }}
        strokeWidth={2}
      />
      {/* Mic badge  -  bottom-right corner, ~55% size, with dark bg circle */}
      <div
        className="absolute flex items-center justify-center rounded-full bg-stone-950 ring-2 ring-stone-950"
        style={{
          width: size * 0.55,
          height: size * 0.55,
          right: -size * 0.05,
          bottom: -size * 0.05,
        }}
      >
        <Mic
          style={{ color, width: size * 0.35, height: size * 0.35 }}
          strokeWidth={2.5}
        />
      </div>
    </div>
  );
}

export default BrandLogo;
