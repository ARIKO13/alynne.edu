/**
 * LofiBackground.tsx  -  Animated canvas background for study mode
 *
 * Renders a calming Lo-Fi aesthetic animation:
 * - Gradient sky (sunset/night)
 * - Floating particles (stars/dust)
 * - Slow-moving clouds
 * - Subtle wave at bottom
 *
 * Pure canvas animation, no video files needed.
 * Performance: ~2% CPU on modern devices.
 */

import { useEffect, useRef } from 'react';

interface LofiBackgroundProps {
  theme?: 'sunset' | 'night' | 'aurora' | 'ocean';
  intensity?: number; // 0-1, controls particle density
}

export function LofiBackground({ theme = 'sunset', intensity = 0.6 }: LofiBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = (canvas.width = canvas.offsetWidth);
    let height = (canvas.height = canvas.offsetHeight);

    const handleResize = () => {
      width = canvas.width = canvas.offsetWidth;
      height = canvas.height = canvas.offsetHeight;
    };
    window.addEventListener('resize', handleResize);

    // Theme colors
    const themes = {
      sunset: {
        sky: ['#1a1a2e', '#16213e', '#e94560', '#f4a261'],
        particles: '#ffd700',
        cloud: 'rgba(255, 255, 255, 0.05)',
        wave: 'rgba(233, 69, 96, 0.1)',
      },
      night: {
        sky: ['#0a0a1a', '#1a1a3e', '#2d2d5f', '#1a1a3e'],
        particles: '#ffffff',
        cloud: 'rgba(100, 100, 255, 0.05)',
        wave: 'rgba(100, 100, 255, 0.1)',
      },
      aurora: {
        sky: ['#0a1a0a', '#1a3a1a', '#4ade80', '#22d3ee'],
        particles: '#a7f3d0',
        cloud: 'rgba(74, 222, 128, 0.05)',
        wave: 'rgba(34, 211, 238, 0.1)',
      },
      ocean: {
        sky: ['#0c4a6e', '#9A3412', '#0284c7', '#38bdf8'],
        particles: '#e0f2fe',
        cloud: 'rgba(255, 255, 255, 0.08)',
        wave: 'rgba(56, 189, 248, 0.15)',
      },
    };

    const colors = themes[theme];

    // Particles (stars/dust)
    const particleCount = Math.floor(50 * intensity);
    const particles = Array.from({ length: particleCount }, () => ({
      x: Math.random() * width,
      y: Math.random() * height * 0.7,
      size: Math.random() * 2 + 0.5,
      speed: Math.random() * 0.3 + 0.1,
      opacity: Math.random() * 0.5 + 0.3,
      twinkle: Math.random() * Math.PI * 2,
    }));

    // Clouds
    const cloudCount = Math.floor(5 * intensity);
    const clouds = Array.from({ length: cloudCount }, (_, i) => ({
      x: Math.random() * width,
      y: height * 0.1 + Math.random() * height * 0.3,
      width: 150 + Math.random() * 200,
      height: 40 + Math.random() * 30,
      speed: 0.1 + Math.random() * 0.2,
      opacity: 0.3 + Math.random() * 0.3,
    }));

    // Wave points
    const wavePoints = 20;
    let waveOffset = 0;

    let frame = 0;

    const draw = () => {
      frame++;

      // Sky gradient
      const grad = ctx.createLinearGradient(0, 0, 0, height);
      grad.addColorStop(0, colors.sky[0]);
      grad.addColorStop(0.3, colors.sky[1]);
      grad.addColorStop(0.7, colors.sky[2]);
      grad.addColorStop(1, colors.sky[3]);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);

      // Stars/particles
      particles.forEach((p) => {
        p.twinkle += 0.02;
        const twinkleOpacity = p.opacity * (0.5 + Math.sin(p.twinkle) * 0.5);
        ctx.fillStyle = colors.particles;
        ctx.globalAlpha = twinkleOpacity;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();

        // Slow drift
        p.y -= p.speed;
        if (p.y < 0) {
          p.y = height * 0.7;
          p.x = Math.random() * width;
        }
      });
      ctx.globalAlpha = 1;

      // Clouds
      clouds.forEach((c) => {
        ctx.fillStyle = colors.cloud;
        ctx.globalAlpha = c.opacity;
        // Draw cloud as overlapping circles
        ctx.beginPath();
        ctx.arc(c.x, c.y, c.height * 0.6, 0, Math.PI * 2);
        ctx.arc(c.x + c.width * 0.2, c.y - c.height * 0.2, c.height * 0.5, 0, Math.PI * 2);
        ctx.arc(c.x + c.width * 0.4, c.y, c.height * 0.6, 0, Math.PI * 2);
        ctx.arc(c.x + c.width * 0.6, c.y - c.height * 0.1, c.height * 0.4, 0, Math.PI * 2);
        ctx.fill();

        c.x += c.speed;
        if (c.x > width + c.width) {
          c.x = -c.width;
          c.y = height * 0.1 + Math.random() * height * 0.3;
        }
      });
      ctx.globalAlpha = 1;

      // Wave at bottom
      waveOffset += 0.01;
      ctx.fillStyle = colors.wave;
      ctx.beginPath();
      ctx.moveTo(0, height);
      for (let i = 0; i <= wavePoints; i++) {
        const x = (i / wavePoints) * width;
        const y = height * 0.85 + Math.sin(i * 0.5 + waveOffset) * 10;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(width, height);
      ctx.closePath();
      ctx.fill();

      // Second wave layer
      ctx.fillStyle = colors.wave;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.moveTo(0, height);
      for (let i = 0; i <= wavePoints; i++) {
        const x = (i / wavePoints) * width;
        const y = height * 0.9 + Math.sin(i * 0.5 + waveOffset + 1) * 8;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(width, height);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;

      animRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener('resize', handleResize);
    };
  }, [theme, intensity]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ opacity: 0.3 }}
    />
  );
}
