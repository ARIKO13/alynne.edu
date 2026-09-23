/**
 * whisper-cpp-worker.js — Web Worker untuk whisper.cpp WASM
 *
 * Flow:
 *   1. Load main.js (WASM module, 1.8MB)
 *   2. Wait for runtime initialized
 *   3. On 'load-model': fetch model → write to FS → init context
 *   4. On 'transcribe': feed PCM audio → capture text → post back
 *
 * API (from emscripten.cpp):
 *   - Module.init(path) → context index (1-based, 0 = fail)
 *   - Module.full_default(index, audioFloat32, lang, nthreads, translate) → 0 = success
 *   - Module.free(index) → cleanup
 *   - Text output via Module.print (realtime transcription)
 */

// State
var Module = null;
var modelLoaded = false;
var contextIndex = 0;
var transcriptionText = '';
var isProcessing = false;

// Setup Module config BEFORE loading main.js
var moduleConfig = {
  // Capture print output (where transcription text goes)
  print: function(text) {
    console.log('[whisper-cpp] print:', text);
    // Parse transcription lines: [00:00:00.000 --> 00:00:05.000]  text
    if (text && text.match(/\[\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}\]/)) {
      // Extract text after timestamp
      var match = text.match(/\]\s*(.+)$/);
      if (match && match[1]) {
        transcriptionText += match[1].trim() + ' ';
        self.postMessage({
          type: 'interim',
          text: transcriptionText.trim()
        });
      }
    }
  },
  
  printErr: function(text) {
    console.error('[whisper-cpp] stderr:', text);
  },
  
  onRuntimeInitialized: function() {
    console.log('[whisper-cpp] WASM runtime initialized');
    self.postMessage({ type: 'ready' });
  },
  
  // Don't exit
  noInitialRun: true,
  noExitRuntime: true,
};

// Load WASM module
console.log('[whisper-cpp] Loading WASM module...');
self.Module = moduleConfig;
importScripts('/whisper-wasm/main.js');

// Check if Module was set up
setTimeout(function() {
  if (typeof Module === 'undefined' || !Module._init) {
    console.log('[whisper-cpp] Module not ready yet, waiting...');
    // Some builds need Module to be called as function
    if (typeof Module === 'function') {
      Module(moduleConfig);
    }
  }
}, 1000);

// Message handler
self.onmessage = async function(e) {
  var data = e.data || {};
  var type = data.type;

  if (type === 'load-model') {
    await loadModel(data.modelUrl);
  } else if (type === 'transcribe') {
    await transcribe(data.audio, data.language || 'id');
  } else if (type === 'free') {
    freeModel();
  }
};

async function loadModel(modelUrl) {
  try {
    console.log('[whisper-cpp] Loading model from:', modelUrl);
    self.postMessage({ type: 'model-loading', progress: 0 });

    // Fetch model file
    var response = await fetch(modelUrl);
    if (!response.ok) {
      throw new Error('Failed to fetch model: ' + response.status);
    }
    
    var contentLength = response.headers.get('content-length');
    var total = parseInt(contentLength, 10);
    var reader = response.body.getReader();
    var chunks = [];
    var received = 0;
    
    while (true) {
      var result = await reader.read();
      if (result.done) break;
      chunks.push(result.value);
      received += result.value.length;
      if (total) {
        self.postMessage({
          type: 'model-loading',
          progress: (received / total) * 100
        });
      }
    }
    
    // Combine chunks
    var modelData = new Uint8Array(received);
    var pos = 0;
    for (var chunk of chunks) {
      modelData.set(chunk, pos);
      pos += chunk.length;
    }
    
    console.log('[whisper-cpp] Model downloaded:', modelData.length, 'bytes');
    
    // Write to WASM virtual filesystem
    var modelPath = '/model.bin';
    Module.FS.writeFile(modelPath, modelData);
    console.log('[whisper-cpp] Model written to FS:', modelPath);
    
    // Initialize whisper context
    contextIndex = Module.init(modelPath);
    if (contextIndex === 0) {
      throw new Error('Failed to init whisper context');
    }
    
    modelLoaded = true;
    console.log('[whisper-cpp] Model loaded, context index:', contextIndex);
    self.postMessage({ type: 'model-loaded' });
    
    // Free model data from JS memory (it's in WASM FS now)
    modelData = null;
    chunks = null;
  } catch (err) {
    console.error('[whisper-cpp] Load model error:', err);
    self.postMessage({
      type: 'error',
      error: err.message || String(err),
      phase: 'load-model'
    });
  }
}

async function transcribe(audioData, language) {
  if (!modelLoaded || contextIndex === 0) {
    self.postMessage({
      type: 'error',
      error: 'Model not loaded',
      phase: 'transcribe'
    });
    return;
  }

  try {
    console.log('[whisper-cpp] Transcribing:', audioData.length, 'samples');
    isProcessing = true;
    transcriptionText = '';
    
    self.postMessage({ type: 'transcribing', progress: 0 });
    
    // Call whisper full_default
    // audioData is Float32Array PCM 16kHz mono
    var result = Module.full_default(
      contextIndex,
      audioData,
      language,
      4,    // nthreads
      false // translate (false = transcribe)
    );
    
    if (result !== 0) {
      throw new Error('Transcription failed, code: ' + result);
    }
    
    // Wait for processing to complete (whisper runs in separate thread)
    // Poll until transcriptionText stops changing
    var lastText = '';
    var stableCount = 0;
    var maxWait = 120000; // 2 min
    var waited = 0;
    
    while (waited < maxWait) {
      await new Promise(r => setTimeout(r, 500));
      waited += 500;
      
      if (transcriptionText === lastText) {
        stableCount++;
        if (stableCount >= 4) { // 2 seconds stable = done
          break;
        }
      } else {
        stableCount = 0;
        lastText = transcriptionText;
      }
      
      self.postMessage({
        type: 'transcribing',
        progress: Math.min(90, (waited / maxWait) * 100)
      });
    }
    
    isProcessing = false;
    var finalText = transcriptionText.trim();
    console.log('[whisper-cpp] Transcription done:', finalText);
    
    self.postMessage({
      type: 'result',
      text: finalText
    });
  } catch (err) {
    isProcessing = false;
    console.error('[whisper-cpp] Transcribe error:', err);
    self.postMessage({
      type: 'error',
      error: err.message || String(err),
      phase: 'transcribe'
    });
  }
}

function freeModel() {
  if (contextIndex > 0) {
    Module.free(contextIndex);
    contextIndex = 0;
    modelLoaded = false;
    console.log('[whisper-cpp] Model freed');
    self.postMessage({ type: 'freed' });
  }
}
