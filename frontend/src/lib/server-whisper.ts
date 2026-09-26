/**
 * server-whisper.ts - Transkripsi via server-side Whisper (VPS faster-whisper)
 *
 * Flow:
 *   1. Convert Float32Array PCM → WAV Blob (16kHz mono)
 *   2. POST WAV ke /api/whisper/transcribe → job_id
 *   3. Poll /api/whisper/jobs/{job_id} sampai completed
 *   4. Return text
 */

const SAMPLE_RATE = 16000;

/**
 * Convert Float32Array PCM to WAV Blob (16kHz mono 16-bit).
 */
export function float32ToWavBlob(samples: Float32Array): Blob {
  const numChannels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = samples.length * bytesPerSample;
  const bufferSize = 44 + dataSize;  // 44 bytes header

  const buffer = new ArrayBuffer(bufferSize);
  const view = new DataView(buffer);

  // WAV header
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);  // chunk size
  view.setUint16(20, 1, true);   // audio format (PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * blockAlign, true);  // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  // PCM samples (float32 → int16)
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * Submit audio untuk transkripsi ke server-side Whisper.
 * Returns job_id.
 */
async function submitTranscription(wavBlob: Blob): Promise<string> {
  const formData = new FormData();
  formData.append('file', wavBlob, 'recording.wav');
  formData.append('language', 'id');

  const response = await fetch('/api/whisper/transcribe', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`Submit failed: ${err.error || response.statusText}`);
  }

  const data = await response.json();
  if (!data.job_id) {
    throw new Error('No job_id in response');
  }

  return data.job_id;
}

/**
 * Poll job status sampai completed atau failed.
 */
async function pollJob(jobId: string, maxWaitMs: number = 300000): Promise<string> {
  const startTime = Date.now();
  const pollInterval = 2000;  // 2 seconds

  while (Date.now() - startTime < maxWaitMs) {
    const response = await fetch(`/api/whisper/jobs/${jobId}`);
    if (!response.ok) {
      throw new Error(`Poll failed: ${response.statusText}`);
    }

    const data = await response.json();
    console.log(`[Server-Whisper] Job ${jobId}: ${data.status}`);

    if (data.status === 'completed') {
      return data.text || data.result?.text || '';
    }

    if (data.status === 'failed') {
      throw new Error(data.error || 'Transcription failed');
    }

    // Wait before next poll
    await new Promise(r => setTimeout(r, pollInterval));
  }

  throw new Error('Transcription timeout (5 min)');
}

/**
 * Transcribe audio via server-side Whisper.
 *
 * @param audioData Float32Array PCM 16kHz mono
 * @returns Transcription text
 */
export async function transcribeViaServer(audioData: Float32Array): Promise<string> {
  console.log(`[Server-Whisper] Converting ${audioData.length} samples to WAV...`);

  // 1. Convert PCM → WAV
  const wavBlob = float32ToWavBlob(audioData);
  console.log(`[Server-Whisper] WAV size: ${(wavBlob.size / 1024).toFixed(1)} KB`);

  // 2. Submit to server
  console.log('[Server-Whisper] Submitting to server...');
  const jobId = await submitTranscription(wavBlob);
  console.log(`[Server-Whisper] Job submitted: ${jobId}`);

  // 3. Poll for result
  console.log('[Server-Whisper] Waiting for transcription...');
  const text = await pollJob(jobId);
  console.log(`[Server-Whisper] Result: "${text.substring(0, 100)}..."`);

  return text.trim();
}
