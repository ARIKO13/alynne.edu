/**
 * deepgram-direct.ts — STT online yang DIPANGGIL LANGSUNG dari browser user.
 *
 * Alur (sesuai keinginan owner):
 *   Browser user ── POST audio ──▶ api.deepgram.com   (IP yang terlihat = IP user)
 *                                ◀── transcript ──
 *   Device user ── transkrip ▶ server Alynne (untuk disimpan, payload teks kecil)
 *
 * Kenapa Deepgram dan bukan FreeAudioToText?
 *   - FreeAudioToText TIDAK mengirim header CORS (terverifikasi: bahkan respons
 *     sukses 200 tanpa Access-Control-Allow-Origin) → browser tidak bisa membaca
 *     responsnya, harus lewat server (IP server yang kelihat).
 *   - Deepgram mengizinkan penuh panggilan dari browser (CORS terverifikasi,
 *     access-control-allow-origin aktif di POST nyata), free $200 kredit per
 *     akun — kuota & IP jadi milik masing-masing user.
 *
 * Key TIDAK pernah disimpan di server Alynne — hanya di localStorage user.
 */

const DG_URL = 'https://api.deepgram.com/v1/listen';

interface DgLog {
  (t: 'info' | 'success' | 'error', m: string): void;
}

async function attemptModel(blob: Blob, apiKey: string, model: string): Promise<string> {
  // Strip codec suffix: 'audio/webm;codecs=opus' → 'audio/webm'
  const mime = (blob.type || 'audio/webm').split(';')[0];
  const url = `${DG_URL}?model=${model}&language=id&smart_format=true&punctuate=true`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Token ${apiKey}`,
      'Content-Type': mime,
    },
    body: blob,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    const err = new Error(`Deepgram ${res.status}: ${errText.slice(0, 140)}`);
    (err as any).status = res.status;
    throw err;
  }
  const data = await res.json();
  return (data?.results?.channels?.[0]?.alternatives?.[0]?.transcript || '').trim();
}

/**
 * Transkripsi langsung dari browser user ke Deepgram (Bahasa Indonesia).
 * Return null kalau tidak ada key / gagal — caller lanjut ke tier fallback.
 */
export async function transcribeDeepgramDirect(
  blob: Blob,
  apiKey: string,
  log?: DgLog
): Promise<string | null> {
  const key = apiKey?.trim();
  if (!key) return null;

  try {
    let text: string;
    try {
      text = await attemptModel(blob, key, 'nova-3');
    } catch (e: any) {
      // Model/language mismatch → coba nova-2 (dukungan id paling matang)
      if (e?.status === 400) {
        text = await attemptModel(blob, key, 'nova-2');
      } else {
        throw e;
      }
    }
    return text || null;
  } catch (e: any) {
    const status = e?.status;
    if (status === 401 || status === 403) {
      log?.('error', 'Key Deepgram tidak valid — cek ulang di Pengaturan (console.deepgram.com).');
    } else if (status === 402 || status === 429) {
      log?.('error', 'Kuota Deepgram habis/limit — pakai mode offline (unduh model) agar tetap gratis.');
    } else {
      console.warn('[Deepgram-direct] gagal:', e?.message || e);
      log?.('error', `Deepgram gagal: ${String(e?.message || e).slice(0, 80)} — lanjut fallback.`);
    }
    return null;
  }
}
