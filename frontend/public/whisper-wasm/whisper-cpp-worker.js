/**
 * whisper-cpp-worker.js v4 — Fix Module init
 *
 * Key insight: main.js starts with:
 *   var Module=typeof Module!="undefined"?Module:{};
 *
 * So we set self.Module BEFORE importScripts.
 * But importScripts overwrites self.Module.
 * Fix: use globalThis.Module and DON'T set it after importScripts.
 */

var modelLoaded = false;
var contextIndex = 0;
var transcriptionText = '';
var isProcessing = false;
var runtimeReady = false;

// Set Module config BEFORE importScripts
// main.js will pick this up: var Module=typeof Module!="undefined"?Module:{}
var Module = {
  print: function(text) {
    if (text && text.match(/\[\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}\]/)) {
      var match = text.match(/\]\s*(.+)$/);
      if (match && match[1]) {
        transcriptionText += match[1].trim() + ' ';
        self.postMessage({ type: 'interim', text: transcriptionText.trim() });
      }
    }
  },
  printErr: function(text) {
    console.error('[whisper-cpp]', text);
  },
  onRuntimeInitialized: function() {
    console.log('[whisper-cpp] Runtime initialized!');
    console.log('[whisper-cpp] Module.FS available:', typeof Module.FS);
    console.log('[whisper-cpp] Module.init available:', typeof Module._init || typeof Module.init);
    runtimeReady = true;
    self.postMessage({ type: 'ready' });
  },
  noInitialRun: true,
  noExitRuntime: true,
  // WASM is embedded in main.js (SINGLE_FILE build)
  // No need for locateFile
};

// Load main.js — it will use our Module config
console.log('[whisper-cpp] Loading WASM module (main.js)...');
importScripts('/whisper-wasm/main.js');

// After importScripts, Module is now the Emscripten module object
// It should have FS, init, free, full_default
console.log('[whisper-cpp] After importScripts:');
console.log('[whisper-cpp] typeof Module:', typeof Module);
console.log('[whisper-cpp] Module.FS:', typeof Module?.FS);
console.log('[whisper-cpp] Module.init:', typeof Module?.init);
console.log('[whisper-cpp] Module._init:', typeof Module?._init);

// If onRuntimeInitialized didn't fire yet, check periodically
var initCheckCount = 0;
var initCheck = setInterval(function() {
  initCheckCount++;
  if (Module && Module.FS && (Module.init || Module._init)) {
    clearInterval(initCheck);
    runtimeReady = true;
    console.log('[whisper-cpp] Runtime ready (poll check, attempt ' + initCheckCount + ')');
    self.postMessage({ type: 'ready' });
  } else if (initCheckCount > 60) { // 30 seconds
    clearInterval(initCheck);
    console.error('[whisper-cpp] Runtime not ready after 30s');
    console.log('[whisper-cpp] Module keys:', Module ? Object.keys(Module).slice(0, 20) : 'undefined');
    // Post ready anyway — let user try
    self.postMessage({ type: 'ready' });
  }
}, 500);

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

    // Wait for runtime
    var waited = 0;
    while (!runtimeReady && waited < 30000) {
      await new Promise(r => setTimeout(r, 500));
      waited += 500;
    }

    // Check FS
    if (!Module || !Module.FS) {
      console.error('[whisper-cpp] Module.FS not available!');
      console.log('[whisper-cpp] Module type:', typeof Module);
      console.log('[whisper-cpp] Module keys:', Module ? Object.keys(Module).slice(0, 30) : 'null');
      throw new Error('Module.FS not available');
    }

    // Fetch model
    var response = await fetch(modelUrl);
    if (!response.ok) throw new Error('Fetch failed: ' + response.status);

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
        self.postMessage({ type: 'model-loading', progress: (received / total) * 100 });
      }
    }

    var modelData = new Uint8Array(received);
    var pos = 0;
    for (var chunk of chunks) {
      modelData.set(chunk, pos);
      pos += chunk.length;
    }

    console.log('[whisper-cpp] Model downloaded:', modelData.length, 'bytes');

    // Write to FS
    var modelPath = '/model.bin';
    Module.FS.writeFile(modelPath, modelData);
    console.log('[whisper-cpp] Model written to FS');

    // Init whisper context
    // Try Module.init() first, then Module._init()
    var initFn = Module.init || Module._init;
    if (typeof initFn !== 'function') {
      throw new Error('Module.init not available. Available: ' + Object.keys(Module).filter(k => k.startsWith('init') || k.startsWith('_init')).join(', '));
    }

    contextIndex = initFn.call(Module, modelPath);
    if (contextIndex === 0) throw new Error('Failed to init whisper context');

    modelLoaded = true;
    console.log('[whisper-cpp] Model loaded, context:', contextIndex);
    self.postMessage({ type: 'model-loaded' });

    modelData = null;
    chunks = null;
  } catch (err) {
    console.error('[whisper-cpp] Load model error:', err);
    self.postMessage({ type: 'error', error: err.message || String(err), phase: 'load-model' });
  }
}

async function transcribe(audioData, language) {
  if (!modelLoaded || contextIndex === 0) {
    self.postMessage({ type: 'error', error: 'Model not loaded', phase: 'transcribe' });
    return;
  }

  try {
    isProcessing = true;
    transcriptionText = '';
    self.postMessage({ type: 'transcribing', progress: 0 });

    // Try Module.full_default or Module._full_default
    var transcribeFn = Module.full_default || Module._full_default;
    if (typeof transcribeFn !== 'function') {
      throw new Error('full_default not available');
    }

    var result = transcribeFn.call(Module, contextIndex, audioData, language, 4, false);
    if (result !== 0) throw new Error('Transcription failed: ' + result);

    // Wait for text to stabilize
    var lastText = '';
    var stableCount = 0;
    var waited = 0;

    while (waited < 120000) {
      await new Promise(r => setTimeout(r, 500));
      waited += 500;
      if (transcriptionText === lastText) {
        stableCount++;
        if (stableCount >= 4) break;
      } else {
        stableCount = 0;
        lastText = transcriptionText;
      }
    }

    isProcessing = false;
    self.postMessage({ type: 'result', text: transcriptionText.trim() });
  } catch (err) {
    isProcessing = false;
    self.postMessage({ type: 'error', error: err.message || String(err), phase: 'transcribe' });
  }
}

function freeModel() {
  if (contextIndex > 0 && Module) {
    var freeFn = Module.free || Module._free;
    if (typeof freeFn === 'function') {
      freeFn.call(Module, contextIndex);
    }
    contextIndex = 0;
    modelLoaded = false;
    self.postMessage({ type: 'freed' });
  }
}
