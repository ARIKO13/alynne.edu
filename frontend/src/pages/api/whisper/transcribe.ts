import type { APIRoute } from 'astro';
import { readFileSync, writeFileSync, unlinkSync } from 'fs';

// v19.5: FreeAudioToText as PRIMARY STT (keyless, unlimited, no Groq)
// API: https://freeaudiototext.com/api/upload (multipart form)
// Poll: https://freeaudiototext.com/api/jobs/{job_id}
// No API key needed, no signup, free

const FAT_API = 'https://freeaudiototext.com/api';
const MAX_POLL_ATTEMPTS = 60; // 60 × 5s = 5 min max wait
const POLL_INTERVAL_MS = 5000;

// ── Antrean adil per-user (in-memory) ──
// FreeAudioToText membatasi proses per-IP. Kalau semua user menembak bareng
// lewat IP server ini, semua job kena 429 (concurrent_limit). Antrean ini:
//   - membatasi job FAT aktif serentak (aman di bawah limit per-IP mereka)
//   - round-robin per user → tidak ada user yang bisa monopoli giliran
// Slot dipegang selama siklus upload+polling selesai (job memang masih hidup
// di sisi FAT sampai selesai).
const FAT_MAX_CONCURRENT = 2;
// State di globalThis: tahan terhadap re-instantiasi modul apapun (build/islands),
// jadi slot antrean benar-benar dibagi satu proses.
type FatQueueState = {
  active: number;
  lastUserId: string;
  waiters: { userId: string; resolve: () => void }[];
};
const fatQ: FatQueueState = ((globalThis as any).__fatQueue ??= {
  active: 0,
  lastUserId: '',
  waiters: [],
});

function fatPump(): void {
  while (fatQ.active < FAT_MAX_CONCURRENT && fatQ.waiters.length > 0) {
    // Round-robin: prioritaskan user yang BUKAN pemain giliran terakhir
    let idx = fatQ.waiters.findIndex((w) => w.userId !== fatQ.lastUserId);
    if (idx === -1) idx = 0;
    const w = fatQ.waiters.splice(idx, 1)[0];
    fatQ.lastUserId = w.userId;
    fatQ.active++;
    w.resolve();
  }
}

async function fatAcquire(userId: string): Promise<void> {
  if (fatQ.active < FAT_MAX_CONCURRENT) {
    fatQ.active++;
    fatQ.lastUserId = userId;
    return;
  }
  const pos = fatQ.waiters.length + 1;
  console.log(`[whisper-fat] antre: user ${userId.slice(0, 8)}… posisi ${pos}`);
  await new Promise<void>((resolve) => fatQ.waiters.push({ userId, resolve }));
}

function fatRelease(): void {
  fatQ.active = Math.max(0, fatQ.active - 1);
  fatPump();
}

/** Identitas user untuk keadilan antrean — decode payload JWT cookie (tanpa verifikasi, bukan untuk keamanan). */
function getFairUserId(request: Request): string {
  const cookie = request.headers.get('cookie') || '';
  const m = cookie.match(/lina-session=([^;]+)/);
  if (m) {
    try {
      const b64 = m[1].split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)));
      if (payload?.id) return String(payload.id);
    } catch {}
  }
  return 'anon';
}

export const POST: APIRoute = async ({ request }) => {
  const fairUserId = getFairUserId(request);
  await fatAcquire(fairUserId);
  try {
    return await handleTranscribe(request);
  } finally {
    fatRelease();
  }
};

async function handleTranscribe(request: Request): Promise<Response> {
  try {
    const formData = await request.formData();
    const audioFile = formData.get('file') as File;
    const language = (formData.get('language') as string) || 'auto';

    if (!audioFile) {
      return Response.json({ error: 'No audio file provided' }, { status: 400 });
    }

    // Write uploaded file to temp
    const tmpPath = '/tmp/whisper-input-' + Date.now() + '-' + audioFile.name;
    const audioBuffer = await audioFile.arrayBuffer();
    writeFileSync(tmpPath, Buffer.from(audioBuffer));

    console.log('[whisper-fat] Upload to FreeAudioToText:', audioFile.name, audioBuffer.byteLength, 'bytes');

    // Step 1: Upload to FreeAudioToText
    // Limit FAT bersifat rate-like per-IP (terverifikasi: upload ke-3 hanya 15s
    // setelah upload ke-2 tetap 429 meski job sebelumnya sudah selesai) →
    // retry dengan jeda saat memegang slot antrean, bukan langsung gagal.
    const uploadFormData = new FormData();
    uploadFormData.append('file', new Blob([new Uint8Array(audioBuffer)], { type: audioFile.type || 'audio/mpeg' }), audioFile.name);
    uploadFormData.append('language', language);

    let uploadRes: Response = await fetch(`${FAT_API}/upload`, {
      method: 'POST',
      body: uploadFormData,
    });
    for (let attempt = 1; attempt <= 2 && uploadRes.status === 429; attempt++) {
      const delayMs = attempt * 25000; // 25s, 50s
      console.log(`[whisper-fat] upload 429 (percobaan ${attempt}), tunggu ${delayMs / 1000}s lalu ulang…`);
      await new Promise((r) => setTimeout(r, delayMs));
      uploadRes = await fetch(`${FAT_API}/upload`, {
        method: 'POST',
        body: uploadFormData,
      });
    }

    if (!uploadRes.ok) {
      const errText = await uploadRes.text().catch(() => '');
      console.error('[whisper-fat] Upload failed:', uploadRes.status, errText);
      
      // If concurrent_limit (429), return friendly error
      if (uploadRes.status === 429) {
        return Response.json({
          error: 'concurrent_limit',
          message: 'Server sedang memproses audio lain. Coba lagi dalam 1 menit.',
        }, { status: 429 });
      }
      
      return Response.json({
        error: 'upload_failed',
        message: `FreeAudioToText HTTP ${uploadRes.status}: ${errText.slice(0, 200)}`,
      }, { status: 500 });
    }

    const uploadData = await uploadRes.json();
    const jobId = uploadData.job_id;

    if (!jobId) {
      return Response.json({
        error: 'no_job_id',
        message: 'FreeAudioToText did not return job_id',
      }, { status: 500 });
    }

    console.log('[whisper-fat] Job created:', jobId);

    // Step 2: Poll for completion
    let transcript = '';
    let jobStatus = 'processing';

    for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

      const statusRes = await fetch(`${FAT_API}/jobs/${jobId}`);
      if (!statusRes.ok) {
        console.warn('[whisper-fat] Status check failed:', statusRes.status);
        continue;
      }

      const statusData = await statusRes.json();
      jobStatus = statusData.job?.status || statusData.status || 'unknown';

      console.log('[whisper-fat] Poll ' + (i + 1) + ': status=' + jobStatus);

      if (jobStatus === 'completed' || jobStatus === 'done') {
        // Extract transcript from response
        transcript = statusData.job?.transcript || statusData.transcript || statusData.job?.ai_result?.transcript || '';
        
        // If transcript has speaker labels [SPK_0], clean them
        transcript = transcript.replace(/\[SPK_\d+\]/g, '').trim();
        
        // If transcript is in segments, join them
        if (!transcript && statusData.job?.segments) {
          transcript = statusData.job.segments.map((s: any) => s.text || '').join(' ');
        }
        
        break;
      }

      if (jobStatus === 'failed' || jobStatus === 'error') {
        return Response.json({
          error: 'transcription_failed',
          message: statusData.job?.error_message || 'FreeAudioToText job failed',
        }, { status: 500 });
      }
    }

    // Cleanup temp file
    try { unlinkSync(tmpPath); } catch {}

    if (!transcript) {
      return Response.json({
        error: 'no_transcript',
        message: 'FreeAudioToText completed but no transcript returned',
        job_id: jobId,
        job_status: jobStatus,
      }, { status: 500 });
    }

    console.log('[whisper-fat] SUCCESS: transcript', transcript.length, 'chars');

    return Response.json({
      text: transcript,
      duration: 0, // FreeAudioToText doesn't return duration reliably
      segments: 0,
      language: language,
      provider: 'freeaudiototext',
      job_id: jobId,
    });

  } catch (err: any) {
    console.error('[whisper-fat] FATAL:', err);
    return Response.json({
      error: 'internal_error',
      message: err?.message || 'Unknown error',
    }, { status: 500 });
  }
};
