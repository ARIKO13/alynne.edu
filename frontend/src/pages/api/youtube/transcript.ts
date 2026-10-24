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

    // v-any-lang: bebas bahasa apapun. Strategi:
    // 1. Coba 'id' (Bahasa Indonesia — preferred untuk user ID)
    // 2. Kalau throw error, parse pesan error untuk ambil daftar bahasa available
    //    Library ngasih tau: "Available languages: en, en, es, fr"
    // 3. Coba tiap bahasa available sampai dapet (skip duplikat)
    // 4. Kalau semua gagal, coba fetch TANPA lang param (default/first available)
    // 5. Kalau masih gagal, baru return error ke user
    const result = await fetchTranscriptAnyLang(videoId);

    if (!result || !result.transcript || result.transcript.length === 0) {
      return Response.json({
        error: 'Video ini tidak memiliki caption/subtitle. YouTube transkrip hanya bisa untuk video yang memiliki subtitle.',
        videoId,
      }, { status: 404 });
    }

    const transcript = result.transcript;
    const language = result.language;
    const fullText = transcript.map(t => t.text).join(' ');
    const totalDuration = transcript[transcript.length - 1]?.offset + transcript[transcript.length - 1]?.duration || 0;
    const entries = transcript.map(t => ({
      time: formatTime(t.offset),
      text: t.text,
    }));

    console.log(`[youtube] Success: ${fullText.length} chars, ${transcript.length} segments, ${Math.round(totalDuration/60)}min, lang=${language}`);

    return Response.json({
      text: fullText,
      videoId,
      language,
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

// ── Helper: fetch transcript dengan fallback bahasa apapun ──
// Library youtube-transcript THROW error kalau lang yang diminta gak available,
// bukan return empty array. Error message-nya ngasih tau bahasa yang available,
// jadi kita parse itu + coba satu-satu.
async function fetchTranscriptAnyLang(videoId: string): Promise<{ transcript: any[]; language: string } | null> {
  // Bahasa prioritas (urutan coba):
  // 1. id — Bahasa Indonesia (preferred user)
  // 2. en, en-US, en-GB — English variants
  // 3. Sisa bahasa yang tersedia di video (dari error message)
  const preferredLangs = ['id', 'en', 'en-US', 'en-GB'];
  const triedLangs = new Set<string>();

  // Tahap 1: Coba bahasa prioritas satu-satu
  for (const lang of preferredLangs) {
    try {
      const t = await YoutubeTranscript.fetchTranscript(videoId, { lang });
      if (t && t.length > 0) {
        console.log(`[youtube] Got transcript in '${lang}': ${t.length} segments`);
        return { transcript: t, language: lang };
      }
    } catch (e: any) {
      // Parse error message untuk ambil daftar bahasa available
      // Format: "🚨 No transcripts are available in id this video (XXX). Available languages: en, en, es"
      const msg = e?.message || '';
      const match = msg.match(/Available languages?:\s*([^\n]+)/i);
      if (match) {
        const availableLangs = match[1]
          .split(',')
          .map(s => s.trim())
          .filter(Boolean);
        console.log(`[youtube] '${lang}' not available. Found available langs from error: ${availableLangs.join(', ')}`);

        // Tahap 2: Coba tiap bahasa yang available (skip yang udah dicoba + skip duplikat)
        for (const availLang of availableLangs) {
          if (triedLangs.has(availLang) || preferredLangs.includes(availLang)) {
            triedLangs.add(availLang);
            continue;
          }
          triedLangs.add(availLang);
          try {
            const t = await YoutubeTranscript.fetchTranscript(videoId, { lang: availLang });
            if (t && t.length > 0) {
              console.log(`[youtube] Got transcript in '${availLang}': ${t.length} segments`);
              return { transcript: t, language: availLang };
            }
          } catch {
            // Bahasa ini juga gagal, lanjut ke berikutnya
          }
        }

        // Sudah coba semua bahasa available dari error message, berhenti coba preferred
        break;
      }
    }
  }

  // Tahap 3: Coba TANPA lang param — ambil default/first available
  console.log('[youtube] All lang attempts failed, trying default (no lang param)...');
  try {
    const t = await YoutubeTranscript.fetchTranscript(videoId);
    if (t && t.length > 0) {
      console.log(`[youtube] Got transcript (default/any lang): ${t.length} segments`);
      return { transcript: t, language: 'auto' };
    }
  } catch (e) {
    console.error('[youtube] Default fetch also failed:', e);
  }

  return null;
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
