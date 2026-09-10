import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ request }) => {
  try {
    const apiKey = request.headers.get('x-groq-api-key') || process.env.GROQ_API_KEY;
    if (!apiKey) {
      return Response.json({ error: 'Groq API key is required' }, { status: 401 });
    }

    let audioBlob: Blob;
    let model = 'whisper-large-v3-turbo';
    let language = 'id';
    let responseFormat = 'text';

    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      // JSON body with base64 audio
      const json = await request.json();
      const audioBase64: string = json.audio || '';
      const mimeType: string = json.mimeType || 'audio/webm';
      model = json.model || model;
      language = json.language || language;
      responseFormat = json.response_format || responseFormat;

      if (!audioBase64) {
        return Response.json({ error: 'Audio data is required' }, { status: 400 });
      }

      const binary = Uint8Array.from(atob(audioBase64), c => c.charCodeAt(0));
      audioBlob = new Blob([binary], { type: mimeType });
    } else {
      // FormData fallback
      const formData = await request.formData();
      const audioFile = formData.get('file') as File | null;
      model = (formData.get('model') as string) || model;
      language = (formData.get('language') as string) || language;
      responseFormat = (formData.get('response_format') as string) || responseFormat;

      if (!audioFile) {
        return Response.json({ error: 'Audio file is required' }, { status: 400 });
      }
      audioBlob = audioFile;
    }

    const body = new FormData();
    body.append('file', audioBlob, 'audio.webm');
    body.append('model', model);
    body.append('language', language);
    body.append('response_format', responseFormat);

    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body,
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Groq STT error:', err);
      return Response.json({ error: `Groq API error: ${response.status} — ${err}` }, { status: response.status });
    }

    // Handle response based on response_format
    if (responseFormat === 'text' || responseFormat === 'verbose_json') {
      // text format returns plain text, not JSON
      const text = await response.text();
      return Response.json({ text: text.trim() });
    } else {
      // JSON format
      const result = await response.json();
      return Response.json(result);
    }
  } catch (error) {
    console.error('STT Groq route error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
};
