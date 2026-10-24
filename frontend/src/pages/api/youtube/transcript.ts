import type { APIRoute } from 'astro';
import { YoutubeTranscript } from 'youtube-transcript';

export const POST: APIRoute = async ({ request }) => {
  try {
    const { url } = await request.json();
    if (!url) {
      return Response.json({ error: 'URL YouTube diperlukan' }, { status: 400 });
    }

    // Extract video ID from various YouTube URL formats
    let videoId = '';
    
    // Method 1: Use URL parsing (most robust)
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      
      if (host.includes('youtube.com')) {
        if (parsed.pathname === '/watch') {
          // Standard: youtube.com/watch?v=XXXXX
          videoId = parsed.searchParams.get('v') || '';
        } else if (parsed.pathname.startsWith('/embed/')) {
          // Embed: youtube.com/embed/XXXXX
          videoId = parsed.pathname.split('/')[2] || '';
        } else if (parsed.pathname.startsWith('/shorts/')) {
          // Shorts: youtube.com/shorts/XXXXX
          videoId = parsed.pathname.split('/')[2] || '';
        } else if (parsed.pathname.startsWith('/v/')) {
          // Old embed: youtube.com/v/XXXXX
          videoId = parsed.pathname.split('/')[2] || '';
        } else if (parsed.pathname.startsWith('/live/')) {
          // Live: youtube.com/live/XXXXX
          videoId = parsed.pathname.split('/')[2] || '';
        }
        // Handle &v= in query (e.g., youtube.com/watch?app=desktop&v=XXXXX)
        if (!videoId) {
          videoId = parsed.searchParams.get('v') || '';
        }
      } else if (host === 'youtu.be' || host === 'www.youtu.be') {
        // Short: youtu.be/XXXXX
        videoId = parsed.pathname.slice(1).split('/')[0] || '';
      }
    } catch {
      // Not a valid URL — will try regex + raw ID below
    }
    
    // Method 2: Regex fallback (for edge cases URL parsing misses)
    if (!videoId) {
      const patterns = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/|youtube\.com\/live\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
        /[?&]v=([a-zA-Z0-9_-]{11})/,
      ];
      for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) {
          videoId = match[1];
          break;
        }
      }
    }
    
    // Method 3: Maybe user pasted just the video ID (11 chars)
    if (!videoId && /^[a-zA-Z0-9_-]{11}$/.test(url.trim())) {
      videoId = url.trim();
    }
    
    if (!videoId) {
      return Response.json({ error: 'URL YouTube tidak valid. Contoh: https://youtube.com/watch?v=XXXXX atau https://youtu.be/XXXXX' }, { status: 400 });
    }

    console.log(`[youtube] Fetching transcript for video: ${videoId}`);

    // Fetch transcript from YouTube (no LLM, no whisper - just YouTube captions)
    const transcript = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'id' });

    if (!transcript || transcript.length === 0) {
      // Try English fallback
      console.log('[youtube] No Indonesian captions, trying English...');
      const enTranscript = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' });
      if (!enTranscript || enTranscript.length === 0) {
        return Response.json({
          error: 'Video ini tidak memiliki caption/subtitle. YouTube transkrip hanya bisa untuk video yang memiliki subtitle.',
          videoId,
        }, { status: 404 });
      }
      // Return English transcript
      const fullText = enTranscript.map(t => t.text).join(' ');
      const totalDuration = enTranscript[enTranscript.length - 1]?.offset + enTranscript[enTranscript.length - 1]?.duration || 0;
      return Response.json({
        text: fullText,
        videoId,
        language: 'en',
        segments: enTranscript.length,
        duration: Math.round(totalDuration),
        duration_min: Math.round(totalDuration / 60),
      });
    }

    // Build full text + timestamped entries
    const fullText = transcript.map(t => t.text).join(' ');
    const totalDuration = transcript[transcript.length - 1]?.offset + transcript[transcript.length - 1]?.duration || 0;

    // Also return timestamped entries for UI
    const entries = transcript.map(t => ({
      time: formatTime(t.offset),
      text: t.text,
    }));

    console.log(`[youtube] Success: ${fullText.length} chars, ${transcript.length} segments, ${Math.round(totalDuration/60)}min`);

    return Response.json({
      text: fullText,
      videoId,
      language: 'id',
      segments: transcript.length,
      duration: Math.round(totalDuration),
      duration_min: Math.round(totalDuration / 60),
      entries,
    });
  } catch (error) {
    console.error('[youtube] Error:', error);
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return Response.json({
      error: `Gagal mengambil transkrip: ${msg}`,
    }, { status: 500 });
  }
};

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
