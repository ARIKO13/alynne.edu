/**
 * AudioWorklet processor untuk capture PCM samples real-time
 * Output: Float32Array mono 16kHz
 */
class AudioRecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffers = [];
    this._isRecording = false;

    this.port.onmessage = (e) => {
      if (e.data.type === 'start') {
        this._buffers = [];
        this._isRecording = true;
      } else if (e.data.type === 'stop') {
        this._isRecording = false;
        // Combine all buffers
        const totalLength = this._buffers.reduce((acc, b) => acc + b.length, 0);
        const result = new Float32Array(totalLength);
        let offset = 0;
        for (const buf of this._buffers) {
          result.set(buf, offset);
          offset += buf.length;
        }
        this.port.postMessage({ type: 'result', data: result }, [result.buffer]);
        this._buffers = [];
      }
    };
  }

  process(inputs) {
    if (!this._isRecording) return true;

    const input = inputs[0];
    if (!input || input.length === 0) return true;

    // Mix down to mono (kalau stereo)
    const channelCount = input.length;
    const sampleCount = input[0].length;
    const mono = new Float32Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      let sum = 0;
      for (let c = 0; c < channelCount; c++) {
        sum += input[c][i];
      }
      mono[i] = sum / channelCount;
    }
    this._buffers.push(mono);

    return true;
  }
}

registerProcessor('audio-recorder-processor', AudioRecorderProcessor);
