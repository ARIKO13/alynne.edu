import type { APIRoute } from 'astro';
import { readFileSync, writeFileSync, unlinkSync } from 'fs';

// v19.5: FreeAudioToText as PRIMARY STT (keyless, unlimited, no Groq)
// API: https://freeaudiototext.com/api/upload (multipart form)
// Poll: https://freeaudiototext.com/api/jobs/{job_id}
// No API key needed, no signup, free

const FAT_API = 'https://freeaudiototext.com/api';
const MAX_POLL_ATTEMPTS = 60; // 60 × 5s = 5 min max wait
const POLL_INTERVAL_MS = 5000;

export const POST: APIRoute = async ({ request }) => {
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
    const uploadFormData = new FormData();
    uploadFormData.append('file', new Blob([new Uint8Array(audioBuffer)], { type: audioFile.type || 'audio/mpeg' }), audioFile.name);
    uploadFormData.append('language', language);

    const uploadRes = await fetch(`${FAT_API}/upload`, {
      method: 'POST',
      body: uploadFormData,
    });

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
