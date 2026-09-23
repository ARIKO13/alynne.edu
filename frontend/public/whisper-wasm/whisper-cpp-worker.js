/**
 * whisper-cpp-worker.js — Web Worker for whisper.cpp WASM
 *
 * Handle BOTH Module patterns:
 *   1. Classic: Module is object, importScripts loads it
 *   2. Modularize: Module is factory function, need to call it
 *
 * Also handle WASM file loading (main.js references whisper.wasm)
 */

var modelLoaded = false;
var contextIndex = 0;
var transcriptionText = '';
var isProcessing = false;
var runtimeReady = false;
var Module = null;

// Module config
var moduleConfig = {
  print: function(text) {
    if (text && text.match(/\[\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}\]/)) {
      var match = text.match(/\]\s*(.+)$/);
      if (match && match[1]) {
        transcriptionText += match[1].trim() + ' ';
        self.postMessage({ type: 'interim', text: transcriptionText.trim() });
      }
    }
  },
  printErr: function(text) { console.error('[whisper-cpp]', text); },
  onRuntimeInitialized: function() {
    console.log('[whisper-cpp] Runtime ready');
    runtimeReady = true;
    self.postMessage({ type: 'ready' });
  },
  noInitialRun: true,
  noExitRuntime: true,
  // Tell Emscripten where to find the .wasm file
  locateFile: function(path) {
    return '/whisper-wasm/' + path;
  },
};

// Load WASM — try multiple approaches
async function initWasm() {
  console.log('[whisper-cpp] Loading WASM module...');

  return new Promise((resolve, reject) => {
    var timeout = setTimeout(() => {
      reject(new Error('WASM init timeout (30s)'));
    }, 30000);

    // Override onRuntimeInitialized to resolve promise
    var origInit = moduleConfig.onRuntimeInitialized;
    moduleConfig.onRuntimeInitialized = function() {
      clearTimeout(timeout);
      console.log('[whisper-cpp] Runtime initialized');
      runtimeReady = true;
      origInit && origInit();
      resolve();
    };

    // Approach 1: Set Module config before importScripts
    // Emscripten classic build will pick up self.Module
    self.Module = moduleConfig;

    // Load the script
    try {
      importScripts('/whisper-wasm/main.js');
    } catch (e) {
      console.error('[whisper-cpp] importScripts failed:', e);
    }

    // After importScripts, check what Module is
    setTimeout(() => {
      if (typeof Module === 'undefined') {
        // Maybe main.js set it as self.Module
        Module = self.Module;
      }

      if (typeof Module === 'function') {
        // Modularize pattern — call Module(config) to get instance
        console.log('[whisper-cpp] Module is function (Modularize), calling it...');
        Module(moduleConfig).then(function(instance) {
          Module = instance;
          console.log('[whisper-cpp] Module instance created');
          // onRuntimeInitialized will fire from instance
        }).catch(function(err) {
          clearTimeout(timeout);
          reject(err);
        });
      } else if (typeof Module === 'object' && Module !== null) {
        // Classic pattern — Module is already the object
        console.log('[whisper-cpp] Module is object (Classic)');
        // Check if FS is available
        if (Module.FS) {
          console.log('[whisper-cpp] FS available immediately');
          runtimeReady = true;
          clearTimeout(timeout);
          resolve();
        }
        // Otherwise wait for onRuntimeInitialized
      } else {
        // Module not set — maybe script failed
        clearTimeout(timeout);
        reject(new Error('Module not defined after importScripts'));
      }
    }, 1000);
  });
}

// Wait for Module.FS to be available
function waitForFS(timeout) {
  return new Promise((resolve, reject) => {
    var waited = 0;
    var check = setInterval(() => {
      if (Module && Module.FS) {
        clearInterval(check);
        resolve();
      } else if (Module && typeof Module === 'object' && Module._init) {
        // _init exists but FS might not — try to use it anyway
        clearInterval(check);
        console.log('[whisper-cpp] _init available, FS might not be');
        resolve();
      } else {
        waited += 500;
        if (waited >= timeout) {
          clearInterval(check);
          reject(new Error('Module.FS not available (timeout ' + (timeout/1000) + 's)'));
        }
      }
    }, 500);
  });
}

// Initialize WASM on worker start
initWasm().then(() => {
  console.log('[whisper-cpp] WASM initialized successfully');
  return waitForFS(15000);
}).then(() => {
  console.log('[whisper-cpp] FS ready');
  self.postMessage({ type: 'ready' });
}).catch((err) => {
  console.error('[whisper-cpp] Init failed:', err);
  // Still post ready so user can try — maybe model load will work
  self.postMessage({ type: 'ready' });
});

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

    // Wait for FS
    if (!Module || !Module.FS) {
      console.log('[whisper-cpp] Waiting for FS...');
      await waitForFS(30000);
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
    contextIndex = Module.init(modelPath);
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

    var result = Module.full_default(contextIndex, audioData, language, 4, false);
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
    Module.free(contextIndex);
    contextIndex = 0;
    modelLoaded = false;
    self.postMessage({ type: 'freed' });
  }
}
