/**
 * whisper-cpp-worker.js — Web Worker untuk whisper.cpp WASM
 *
 * Fix: wait for Module.FS ready sebelum writeFile
 * Fix: proper Module initialization
 */

var Module = null;
var modelLoaded = false;
var contextIndex = 0;
var transcriptionText = '';
var isProcessing = false;
var runtimeReady = false;

// Setup Module config
var moduleConfig = {
  print: function(text) {
    console.log('[whisper-cpp] print:', text);
    if (text && text.match(/\[\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}\]/)) {
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
    runtimeReady = true;
    self.postMessage({ type: 'ready' });
  },
  
  noInitialRun: true,
  noExitRuntime: true,
};

// Load WASM module
console.log('[whisper-cpp] Loading WASM module...');
self.Module = moduleConfig;
importScripts('/whisper-wasm/main.js');

// Some Emscripten builds need Module to be called as function
setTimeout(function() {
  if (typeof Module === 'function') {
    console.log('[whisper-cpp] Module is function, calling it...');
    Module(moduleConfig);
  } else if (typeof Module !== 'undefined' && Module._init) {
    console.log('[whisper-cpp] Module already ready');
    runtimeReady = true;
    self.postMessage({ type: 'ready' });
  }
}, 2000);

// Wait for runtime to be ready
function waitForRuntime(timeout) {
  return new Promise(function(resolve, reject) {
    var waited = 0;
    var interval = setInterval(function() {
      if (runtimeReady || (typeof Module !== 'undefined' && Module.FS && Module._init)) {
        clearInterval(interval);
        runtimeReady = true;
        resolve();
      } else {
        waited += 500;
        if (waited >= timeout) {
          clearInterval(interval);
          reject(new Error('WASM runtime not ready (timeout ' + (timeout/1000) + 's)'));
        }
      }
    }, 500);
  });
}

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

    // Wait for runtime to be ready (max 30 seconds)
    if (!runtimeReady) {
      console.log('[whisper-cpp] Waiting for WASM runtime...');
      await waitForRuntime(30000);
    }

    // Verify Module.FS is available
    if (!Module || !Module.FS) {
      throw new Error('Module.FS not available after runtime ready');
    }
    console.log('[whisper-cpp] Module.FS available');

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
    
    // Free model data from JS memory
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
    var result = Module.full_default(
      contextIndex,
      audioData,
      language,
      4,    // nthreads
      false // translate
    );
    
    if (result !== 0) {
      throw new Error('Transcription failed, code: ' + result);
    }
    
    // Wait for processing (whisper runs in separate thread)
    var lastText = '';
    var stableCount = 0;
    var maxWait = 120000;
    var waited = 0;
    
    while (waited < maxWait) {
      await new Promise(r => setTimeout(r, 500));
      waited += 500;
      
      if (transcriptionText === lastText) {
        stableCount++;
        if (stableCount >= 4) break;
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
  if (contextIndex > 0 && Module) {
    Module.free(contextIndex);
    contextIndex = 0;
    modelLoaded = false;
    console.log('[whisper-cpp] Model freed');
    self.postMessage({ type: 'freed' });
  }
}
