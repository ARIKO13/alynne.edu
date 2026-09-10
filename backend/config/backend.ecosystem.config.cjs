module.exports = {
  apps: [{
    name: "whisper-backend",
    script: "/usr/bin/python3",
    args: "-m uvicorn main:app --host 0.0.0.0 --port 8000",
    cwd: "/root/whisper-backend",
    env: {
      // Whisper (8-bit int8)
      WHISPER_MODEL: "large-v3-turbo",
      WHISPER_DEVICE: "cpu",
      WHISPER_COMPUTE: "int8",
      CHUNK_MINUTES: "1",

      // Qwen (4-bit Q4_K_M)
      QWEN_MODEL_PATH: "/root/models/qwen2.5-1.5b-instruct-q4_k_m.gguf",
      QWEN_N_CTX: "4096",
      QWEN_N_THREADS: "4",
      QWEN_N_GPU_LAYERS: "0",

      // Dynamic loading
      IDLE_TIMEOUT: "300", // 5 minutes idle → auto-unload

      // Misc
      TF_CPP_MIN_LOG_LEVEL: "3",
      HF_HOME: "/root/.cache/huggingface",
    },
    max_memory_restart: "6G", // 8GB RAM + 4GB swap = 12GB total
  }]
};
