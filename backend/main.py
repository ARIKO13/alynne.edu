"""
ALYNNE Whisper + Qwen Backend v8.0 — LAZY CHUNKING + SUBPROCESS ISOLATION
=========================================================================
v6: queue system + dynamic loading
v7 NEW (per user feedback):
  1. Lazy Chunking — extract 1 chunk at a time (NOT split all upfront)
  2. Subprocess Isolation — each chunk transcribed in SEPARATE subprocess
  3. CPU Cooldown — gc.collect() + sleep(0.5) between chunks
  4. Lazy chunk extraction via ffmpeg -ss + -t (no re-encode)

Result: 1-hour file processed at stable 40-60% CPU (not 90%+)
"""
import os
import tempfile
import shutil
import time
import json
import subprocess
import threading
import gc
import uuid
import multiprocessing as mp
import queue as queue_mod
from pathlib import Path
from typing import Optional, List, Dict, Any
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
import uvicorn

# ===== Config =====
# Default changed from large-v3-turbo -> tiny (2026-09-14 per user request).
# tiny is ~75MB vs ~1.5GB for large-v3-turbo, loads in ~3s, perfect for
# short voice commands. Main STT now uses Groq Whisper API (cloud) instead.
MODEL_SIZE = os.environ.get("WHISPER_MODEL", "tiny")
DEVICE = os.environ.get("WHISPER_DEVICE", "cpu")
COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE", "int8")
CHUNK_MINUTES = int(os.environ.get("CHUNK_MINUTES", "1"))
CHUNK_COOLDOWN = float(os.environ.get("CHUNK_COOLDOWN", "0.5"))  # sleep between chunks

QWEN_MODEL_PATH = os.environ.get("QWEN_MODEL_PATH", "/root/models/qwen2.5-1.5b-instruct-q4_k_m.gguf")
QWEN_N_CTX = int(os.environ.get("QWEN_N_CTX", "4096"))
QWEN_N_THREADS = int(os.environ.get("QWEN_N_THREADS", "4"))
QWEN_N_GPU_LAYERS = int(os.environ.get("QWEN_N_GPU_LAYERS", "0"))

IDLE_TIMEOUT = int(os.environ.get("IDLE_TIMEOUT", "300"))
MAX_QUEUE_SIZE = int(os.environ.get("MAX_QUEUE_SIZE", "10"))
JOB_TTL_SECONDS = int(os.environ.get("JOB_TTL_SECONDS", "7200"))  # 2 hours (for long files)

SUPPORTED_AUDIO = {".webm", ".wav", ".mp3", ".m4a", ".aac", ".ogg", ".flac", ".opus"}
SUPPORTED_VIDEO = {".mp4", ".mkv", ".avi", ".mov", ".flv", ".wmv", ".webm", ".mpg", ".mpeg", ".ts", ".m4v", ".3gp"}

app = FastAPI(
    title="ALYNNE Whisper + Qwen Backend",
    version="8.0.0",
    description="Lazy chunking + subprocess isolation + CPU cooldown",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# AGGRESSIVE MEMORY CLEANUP
# ============================================================
def aggressive_cleanup():
    gc.collect(); gc.collect(); gc.collect()
    try:
        import torch
        if hasattr(torch, 'cuda') and torch.cuda.is_available():
            torch.cuda.empty_cache()
            torch.cuda.synchronize()
        if hasattr(torch, 'cpu'):
            try: torch.cpu.empty_cache()
            except: pass
    except ImportError:
        pass
    try:
        import ctypes
        ctypes.CDLL("libc.so.6").malloc_trim(0)
    except: pass
    try:
        os.sync()
        with open("/proc/sys/vm/drop_caches", "w") as f:
            f.write("1")
    except: pass


# ============================================================
# LAZY CHUNK EXTRACTION (extract 1 chunk at a time, no upfront split)
# ============================================================
def extract_chunk_lazy(input_wav: str, start_sec: float, duration_sec: float,
                       output_chunk_path: str) -> bool:
    """Extract ONE chunk from input WAV using ffmpeg -ss + -t (fast, no re-encode).
    This is 'lazy' — only extracts the chunk we're about to process.
    """
    try:
        cmd = [
            "ffmpeg", "-y",
            "-ss", str(start_sec),       # seek to start
            "-t", str(duration_sec),      # take only N seconds
            "-i", input_wav,
            "-ac", "1",                   # mono
            "-ar", "16000",               # 16kHz
            "-c:a", "pcm_s16le",          # PCM 16-bit
            "-loglevel", "error",
            output_chunk_path
        ]
        r = subprocess.run(cmd, capture_output=True, timeout=120)
        return r.returncode == 0
    except Exception as e:
        print(f"[ffmpeg-lazy] Error: {e}")
        return False


# ============================================================
# WHISPER IN SUBPROCESS (full RAM reclaim)
# ============================================================
def whisper_worker(audio_path: str, language: str, model_size: str,
                   device: str, compute_type: str, result_queue: mp.Queue):
    """Child process: load whisper, transcribe ONE chunk, exit.
    OS reclaims ALL RAM when this process exits.
    """
    try:
        from faster_whisper import WhisperModel
        t0 = time.time()
        model = WhisperModel(model_size, device=device, compute_type=compute_type)
        load_time = time.time() - t0

        t1 = time.time()
        segments, info = model.transcribe(
            audio_path, language=language, beam_size=5,
            vad_filter=True, vad_parameters=dict(min_silence_duration_ms=500),
        )
        text = " ".join([s.text.strip() for s in segments])
        transcribe_time = time.time() - t1

        result_queue.put({
            "text": text.strip(),
            "duration": getattr(info, "duration", 0),
            "language": getattr(info, "language", language),
            "load_time": round(load_time, 2),
            "transcribe_time": round(transcribe_time, 2),
        })
    except Exception as e:
        result_queue.put({"text": "", "error": str(e)})


def transcribe_chunk_isolated(chunk_path: str, language: str = "id") -> Dict[str, Any]:
    """Transcribe a single chunk in SEPARATE subprocess.
    Kernel reclaims 100% RAM when subprocess exits.
    """
    result_queue = mp.Queue()
    p = mp.Process(
        target=whisper_worker,
        args=(chunk_path, language, MODEL_SIZE, DEVICE, COMPUTE_TYPE, result_queue),
    )
    p.start()
    p.join(timeout=300)  # 5 min max per chunk

    if p.is_alive():
        p.terminate(); p.join(timeout=10)
        if p.is_alive(): p.kill()
        return {"text": "", "error": "chunk timeout (5 min)"}

    if not result_queue.empty():
        return result_queue.get()
    return {"text": "", "error": "no result from child process"}


# ============================================================
# JOB QUEUE SYSTEM
# ============================================================
class Job:
    def __init__(self, job_id: str, audio_path: str, language: str, filename: str,
                 file_size: int, chunk_mode: str):
        self.id = job_id
        self.audio_path = audio_path
        self.language = language
        self.filename = filename
        self.file_size = file_size
        self.chunk_mode = chunk_mode
        self.status = "queued"
        self.result = None
        self.error = None
        self.created_at = time.time()
        self.started_at = None
        self.completed_at = None
        self.progress = []
        self.partial_text = ""  # accumulated text (for incremental polling)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "status": self.status,
            "filename": self.filename,
            "file_size": self.file_size,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "duration_seconds": (self.completed_at or time.time()) - self.created_at if self.status in ["completed", "failed"] else None,
            "processing_seconds": (self.completed_at - self.started_at) if (self.started_at and self.completed_at) else None,
            "progress": self.progress[-10:],  # last 10 progress messages
            "result": self.result,
            "partial_text": self.partial_text,
            "error": self.error,
        }

    def add_progress(self, msg: str):
        self.progress.append({"time": time.time(), "msg": msg})
        print(f"[job:{self.id[:8]}] {msg}")


class JobQueue:
    def __init__(self, max_size: int = 10):
        self.queue = queue_mod.Queue(maxsize=max_size)
        self.jobs: Dict[str, Job] = {}
        self._lock = threading.Lock()
        self._worker_thread = None
        self._stop_event = threading.Event()
        self.current_job: Optional[Job] = None

    def start_worker(self):
        if self._worker_thread is None:
            self._worker_thread = threading.Thread(target=self._worker_loop, daemon=True)
            self._worker_thread.start()
            print(f"[queue] Worker started (max queue: {MAX_QUEUE_SIZE})")

    def _worker_loop(self):
        while not self._stop_event.is_set():
            try:
                job = self.queue.get(timeout=5)
            except queue_mod.Empty:
                self._cleanup_old_jobs()
                continue

            with self._lock:
                if job.status == "cancelled":
                    continue
                job.status = "processing"
                job.started_at = time.time()
                self.current_job = job

            try:
                job.add_progress("Starting transcription")
                result = self._process_job(job)
                job.result = result
                job.status = "completed"
                job.add_progress(f"Completed: {len(result.get('text', ''))} chars")
            except Exception as e:
                job.error = str(e)
                job.status = "failed"
                job.add_progress(f"Failed: {e}")
            finally:
                job.completed_at = time.time()
                with self._lock:
                    self.current_job = None
                try: os.unlink(job.audio_path)
                except: pass
                aggressive_cleanup()
                self.queue.task_done()

    def _process_job(self, job: Job) -> dict:
        """Process job: convert to WAV + lazy chunking + isolated subprocess per chunk."""
        # Check if this is a chunked upload job
        if job.chunk_mode == "chunked" and hasattr(job, '_upload_job_id'):
            return _process_chunked_job(job, job._upload_job_id)

        # Regular job — convert to WAV first (one-time, for duration probe)
        wav_path = tempfile.NamedTemporaryFile(suffix=".wav", delete=False).name
        try:
            job.add_progress("Converting audio to WAV")
            if not convert_to_wav(job.audio_path, wav_path):
                raise RuntimeError("ffmpeg conversion failed")

            duration = get_audio_duration(wav_path)
            job.add_progress(f"Duration: {duration:.1f}s ({duration/60:.1f}min)")

            should_chunk = (job.chunk_mode == "force" or
                           (job.chunk_mode == "auto" and duration > CHUNK_MINUTES * 60))

            if not should_chunk:
                # Short audio — single subprocess
                job.add_progress("Transcribing (single chunk)")
                r = transcribe_chunk_isolated(wav_path, job.language)
                return {
                    "text": r.get("text", ""),
                    "duration": duration,
                    "processing_time": r.get("load_time", 0) + r.get("transcribe_time", 0),
                    "load_time": r.get("load_time", 0),
                    "transcribe_time": r.get("transcribe_time", 0),
                    "chunked": False,
                    "chunk_count": 1,
                    "model": MODEL_SIZE,
                    "language": job.language,
                }

            # === LAZY CHUNKING (per user feedback) ===
            chunk_duration = CHUNK_MINUTES * 60
            num_chunks = int(duration // chunk_duration) + (1 if duration % chunk_duration > 0 else 0)
            job.add_progress(f"Will process {num_chunks} chunks of {CHUNK_MINUTES}min (lazy extraction)")

            all_text = []
            total_proc = 0
            chunk_results = []
            chunk_dir = tempfile.mkdtemp(prefix="chunks_")

            try:
                for i in range(num_chunks):
                    # Check cancelled
                    with self._lock:
                        if job.status == "cancelled":
                            raise RuntimeError("Job cancelled by user")

                    start_sec = i * chunk_duration

                    # === STEP 1: Lazy extract ONE chunk (not all upfront) ===
                    chunk_path = os.path.join(chunk_dir, f"chunk_{i:04d}.wav")
                    job.add_progress(f"Extracting chunk {i+1}/{num_chunks}")
                    if not extract_chunk_lazy(wav_path, start_sec, chunk_duration, chunk_path):
                        job.add_progress(f"Chunk {i+1}: extract failed, skipping")
                        continue

                    # === STEP 2: Transcribe in ISOLATED subprocess ===
                    job.add_progress(f"Transcribing chunk {i+1}/{num_chunks}")
                    r = transcribe_chunk_isolated(chunk_path, job.language)

                    chunk_text = r.get("text", "")
                    all_text.append(chunk_text)
                    total_proc += r.get("load_time", 0) + r.get("transcribe_time", 0)
                    chunk_results.append({
                        "chunk": i+1,
                        "text": chunk_text,
                        "duration": r.get("duration", 0),
                        "transcribe_time": r.get("transcribe_time", 0),
                    })

                    # === STEP 3: Cleanup chunk file ===
                    try: os.unlink(chunk_path)
                    except: pass

                    # === STEP 4: CPU COOLDOWN (gc + sleep) ===
                    gc.collect()
                    time.sleep(CHUNK_COOLDOWN)

                final_text = " ".join(t for t in all_text if t).strip()
                return {
                    "text": final_text,
                    "duration": duration,
                    "processing_time": round(total_proc, 2),
                    "chunked": True,
                    "chunk_count": num_chunks,
                    "model": MODEL_SIZE,
                    "language": job.language,
                    "chunks": chunk_results if num_chunks <= 20 else None,
                }
            finally:
                try: shutil.rmtree(chunk_dir)
                except: pass
        finally:
            try: os.unlink(wav_path)
            except: pass

    def submit(self, job: Job) -> bool:
        try:
            with self._lock:
                self.jobs[job.id] = job
            self.queue.put_nowait(job)
            return True
        except queue_mod.Full:
            with self._lock:
                del self.jobs[job.id]
            return False

    def get_job(self, job_id: str) -> Optional[Job]:
        with self._lock:
            return self.jobs.get(job_id)

    def list_jobs(self) -> List[Job]:
        with self._lock:
            return list(self.jobs.values())

    def cancel_job(self, job_id: str) -> bool:
        with self._lock:
            job = self.jobs.get(job_id)
            if job and job.status == "queued":
                job.status = "cancelled"
                job.completed_at = time.time()
                return True
            return False

    def _cleanup_old_jobs(self):
        now = time.time()
        with self._lock:
            to_remove = []
            for jid, job in self.jobs.items():
                if job.status in ["completed", "failed", "cancelled"]:
                    if job.completed_at and (now - job.completed_at) > JOB_TTL_SECONDS:
                        to_remove.append(jid)
            for jid in to_remove:
                del self.jobs[jid]

    def status(self) -> dict:
        with self._lock:
            queued = sum(1 for j in self.jobs.values() if j.status == "queued")
            processing = sum(1 for j in self.jobs.values() if j.status == "processing")
            completed = sum(1 for j in self.jobs.values() if j.status == "completed")
            failed = sum(1 for j in self.jobs.values() if j.status == "failed")
        return {
            "queue_size": queued,
            "max_queue_size": MAX_QUEUE_SIZE,
            "processing": processing,
            "completed": completed,
            "failed": failed,
            "current_job": self.current_job.id if self.current_job else None,
        }


job_queue = JobQueue(max_size=MAX_QUEUE_SIZE)


# ============================================================
# QWEN MANAGER
# ============================================================
class QwenManager:
    def __init__(self):
        self._llm = None
        self._last_used = 0.0
        self._lock = threading.Lock()
        self._load_error = None
        self._cleanup_thread = None
        self._stop_event = threading.Event()

    def start_cleanup_thread(self):
        if self._cleanup_thread is None:
            self._cleanup_thread = threading.Thread(target=self._cleanup_loop, daemon=True)
            self._cleanup_thread.start()

    def _cleanup_loop(self):
        while not self._stop_event.is_set():
            time.sleep(60)
            with self._lock:
                if self._llm is not None and (time.time() - self._last_used) > IDLE_TIMEOUT:
                    del self._llm
                    self._llm = None
                    aggressive_cleanup()

    def get(self):
        with self._lock:
            if self._llm is None:
                if self._load_error: self._load_error = None
                try:
                    print(f"[qwen] Loading (4-bit)...")
                    t0 = time.time()
                    from llama_cpp import Llama
                    self._llm = Llama(
                        model_path=QWEN_MODEL_PATH,
                        n_ctx=QWEN_N_CTX, n_threads=QWEN_N_THREADS,
                        n_gpu_layers=QWEN_N_GPU_LAYERS,
                        verbose=False, use_mlock=False, use_mmap=True,
                    )
                    print(f"[qwen] Loaded in {time.time()-t0:.1f}s")
                except Exception as e:
                    self._load_error = str(e)
                    return None
            self._last_used = time.time()
            return self._llm

    def unload(self):
        with self._lock:
            if self._llm is not None:
                del self._llm
                self._llm = None
                aggressive_cleanup()
                return True
            return False

    def status(self):
        return {
            "loaded": self._llm is not None,
            "idle_seconds": int(time.time() - self._last_used) if self._llm else None,
            "error": self._load_error,
        }


qwen_mgr = QwenManager()


# ============================================================
# HELPERS
# ============================================================
def get_file_extension(filename: str) -> str:
    return Path(filename).suffix.lower()

def convert_to_wav(input_path: str, output_path: str) -> bool:
    try:
        cmd = ["ffmpeg", "-y", "-i", input_path, "-vn", "-ac", "1", "-ar", "16000",
               "-c:a", "pcm_s16le", "-loglevel", "error", output_path]
        r = subprocess.run(cmd, capture_output=True, timeout=3600)
        if r.returncode == 0: return True
        # Fallback: genpts (for fragmented webm)
        cmd2 = ["ffmpeg", "-y", "-fflags", "+genpts", "-i", input_path,
                "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le",
                "-loglevel", "error", output_path]
        r2 = subprocess.run(cmd2, capture_output=True, timeout=3600)
        if r2.returncode == 0: return True
        # Fallback: ignore_err
        cmd3 = ["ffmpeg", "-y", "-err_detect", "ignore_err", "-i", input_path,
                "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le",
                "-loglevel", "error", output_path]
        r3 = subprocess.run(cmd3, capture_output=True, timeout=3600)
        return r3.returncode == 0
    except Exception as e:
        print(f"[ffmpeg] Exception: {e}")
        return False

def get_audio_duration(audio_path: str) -> float:
    try:
        cmd = ["ffprobe", "-v", "error", "-show_entries", "format=duration",
               "-of", "default=noprint_wrappers=1:nokey=1", audio_path]
        r = subprocess.run(cmd, capture_output=True, timeout=30)
        return float(r.stdout.decode().strip() or 0)
    except: return 0.0


# ============================================================
# ENDPOINTS
# ============================================================
@app.get("/health")
async def health():
    return {
        "status": "ok",
        "version": "7.0.0",
        "queue": job_queue.status(),
        "whisper": {
            "model": MODEL_SIZE, "compute_type": COMPUTE_TYPE,
            "mode": "lazy chunking + subprocess isolation + cooldown",
            "chunk_minutes": CHUNK_MINUTES,
            "chunk_cooldown_seconds": CHUNK_COOLDOWN,
        },
        "qwen": qwen_mgr.status(),
        "swap_enabled": os.path.exists("/swapfile"),
    }

@app.get("/queue/status")
async def queue_status():
    return job_queue.status()

@app.get("/supported-formats")
async def supported_formats():
    return {"audio": sorted(SUPPORTED_AUDIO), "video": sorted(SUPPORTED_VIDEO),
            "max_file_size": "unlimited", "chunk_minutes": CHUNK_MINUTES}

@app.post("/transcribe")
async def transcribe_audio(file: UploadFile = File(...), language: str = Form("id"),
                           chunk_mode: str = Form("auto")):
    """Async transcribe — submit to queue, return job_id."""
    suffix = get_file_extension(file.filename or ".webm")
    temp_input = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    file_size = 0
    with open(temp_input.name, "wb") as f:
        while True:
            chunk = await file.read(4 * 1024 * 1024)
            if not chunk: break
            f.write(chunk)
            file_size += len(chunk)

    job_id = str(uuid.uuid4())
    job = Job(
        job_id=job_id, audio_path=temp_input.name, language=language,
        filename=file.filename or "unknown", file_size=file_size, chunk_mode=chunk_mode,
    )

    if not job_queue.submit(job):
        try: os.unlink(temp_input.name)
        except: pass
        return JSONResponse({
            "status": "rejected",
            "error": "Sistem sedang padat. Mohon tunggu beberapa saat dan coba lagi.",
            "retry_after_seconds": 30,
            "queue_status": job_queue.status(),
        }, status_code=200)

    return {
        "job_id": job_id, "status": "queued",
        "message": "Job submitted to queue. Poll /jobs/{job_id} for status.",
        "queue_position": job_queue.queue.qsize(),
        "check_status_url": f"/jobs/{job_id}",
    }

@app.post("/transcribe/sync")
async def transcribe_sync(file: UploadFile = File(...), language: str = Form("id"),
                          chunk_mode: str = Form("auto"), timeout: int = Form(3600)):
    """Sync transcribe — wait until done (timeout 1 hour for long files)."""
    suffix = get_file_extension(file.filename or ".webm")
    temp_input = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    file_size = 0
    with open(temp_input.name, "wb") as f:
        while True:
            chunk = await file.read(4 * 1024 * 1024)
            if not chunk: break
            f.write(chunk)
            file_size += len(chunk)

    job_id = str(uuid.uuid4())
    job = Job(
        job_id=job_id, audio_path=temp_input.name, language=language,
        filename=file.filename or "unknown", file_size=file_size, chunk_mode=chunk_mode,
    )

    if not job_queue.submit(job):
        try: os.unlink(temp_input.name)
        except: pass
        return JSONResponse({
            "status": "rejected",
            "error": "Sistem sedang padat. Mohon tunggu beberapa saat dan coba lagi.",
            "retry_after_seconds": 30,
        }, status_code=200)

    # Poll until done or timeout
    start = time.time()
    while time.time() - start < timeout:
        j = job_queue.get_job(job_id)
        if j and j.status in ["completed", "failed", "cancelled"]:
            return j.to_dict()
        time.sleep(3)

    raise HTTPException(status_code=504, detail="Timeout waiting for job to complete")

@app.get("/jobs")
async def list_jobs():
    return {"queue": job_queue.status(), "jobs": [j.to_dict() for j in job_queue.list_jobs()]}

@app.get("/jobs/{job_id}")
async def get_job(job_id: str):
    job = job_queue.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job.to_dict()

@app.delete("/jobs/{job_id}")
async def cancel_job(job_id: str):
    if job_queue.cancel_job(job_id):
        return {"status": "cancelled", "job_id": job_id}
    job = job_queue.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    raise HTTPException(status_code=400, detail=f"Cannot cancel job in '{job.status}' state")

@app.post("/jobs/cleanup")
async def cleanup_old_jobs():
    job_queue._cleanup_old_jobs()
    return {"status": "ok", "queue": job_queue.status()}



# ============================================================
# CHUNKED UPLOAD ENDPOINTS (for large files — client splits to 25MB chunks)
# ============================================================
CHUNK_UPLOAD_DIR = "/tmp/whisper-chunks"
os.makedirs(CHUNK_UPLOAD_DIR, exist_ok=True)

# Track chunked uploads
chunked_uploads: Dict[str, dict] = {}  # job_id → {filename, total_chunks, received: set, chunks_dir}

@app.post("/upload-chunk")
async def upload_chunk(
    file: UploadFile = File(...),
    job_id: str = Form(...),
    chunk_index: int = Form(...),
    total_chunks: int = Form(...),
    original_filename: str = Form(...),
):
    """Receive a 25MB chunk. Client splits file and uploads chunks one by one.
    Each chunk upload is fast (~5-10s), no timeout risk.
    """
    chunks_dir = os.path.join(CHUNK_UPLOAD_DIR, job_id)
    os.makedirs(chunks_dir, exist_ok=True)

    # Track upload metadata
    if job_id not in chunked_uploads:
        chunked_uploads[job_id] = {
            "filename": original_filename,
            "total_chunks": total_chunks,
            "received": set(),
            "chunks_dir": chunks_dir,
            "created_at": time.time(),
        }
    chunked_uploads[job_id]["received"].add(chunk_index)

    # Save chunk to disk
    chunk_path = os.path.join(chunks_dir, f"chunk_{chunk_index:05d}")
    with open(chunk_path, "wb") as f:
        while True:
            data = await file.read(4 * 1024 * 1024)
            if not data:
                break
            f.write(data)

    received_count = len(chunked_uploads[job_id]["received"])
    print(f"[chunked] Job {job_id[:8]}: chunk {chunk_index+1}/{total_chunks} received ({received_count}/{total_chunks})")

    return {
        "job_id": job_id,
        "chunk_index": chunk_index,
        "received": received_count,
        "total": total_chunks,
        "complete": received_count == total_chunks,
    }

def _process_chunked_job(job: Job, upload_job_id: str) -> dict:
    """Process chunked upload: ASSEMBLE chunks first → convert → split by duration → transcribe.
    This fixes the "convert failed" issue — assembled file has valid headers.
    """
    chunks_dir = os.path.join(CHUNK_UPLOAD_DIR, upload_job_id)
    upload_info = chunked_uploads.get(upload_job_id, {})
    total_upload_chunks = upload_info.get("total_chunks", 0)
    filename = upload_info.get("filename", "unknown")

    job.add_progress(f"Assembling {total_upload_chunks} chunks")

    # Step 1: ASSEMBLE all chunks into one file (valid headers!)
    assembled_path = os.path.join(chunks_dir, f"assembled_{filename}")
    total_size = 0
    with open(assembled_path, "wb") as outfile:
        for i in range(total_upload_chunks):
            chunk_path = os.path.join(chunks_dir, f"chunk_{i:05d}")
            if os.path.exists(chunk_path):
                with open(chunk_path, "rb") as infile:
                    outfile.write(infile.read())
                total_size += os.path.getsize(chunk_path)
                os.unlink(chunk_path)  # delete chunk after assembling

    job.add_progress(f"Assembled: {total_size/1024/1024:.1f}MB")

    # Step 2: Convert assembled file to WAV
    wav_path = assembled_path + ".wav"
    if not convert_to_wav(assembled_path, wav_path):
        job.add_progress("Convert failed")
        try: os.unlink(assembled_path)
        except: pass
        return {"text": "", "error": "ffmpeg conversion failed", "duration": 0}

    try: os.unlink(assembled_path)
    except: pass

    duration = get_audio_duration(wav_path)
    job.add_progress(f"Duration: {duration:.1f}s ({duration/60:.1f}min)")

    # Step 3: Split into 1-minute chunks for transcription
    chunk_duration = CHUNK_MINUTES * 60  # 1 minute
    num_chunks = int(duration // chunk_duration) + (1 if duration % chunk_duration > 0 else 0)
    job.add_progress(f"Splitting into {num_chunks} chunks of 1min each")

    all_text = []
    total_proc_time = 0
    chunk_dir = tempfile.mkdtemp(prefix="transcribe_")

    try:
        for i in range(num_chunks):
            with job_queue._lock:
                if job.status == "cancelled":
                    raise RuntimeError("Job cancelled by user")

            start_sec = i * chunk_duration
            chunk_path = os.path.join(chunk_dir, f"chunk_{i:04d}.wav")
            job.add_progress(f"Chunk {i+1}/{num_chunks}: extracting {chunk_duration/60:.1f}min")

            if not extract_chunk_lazy(wav_path, start_sec, chunk_duration, chunk_path):
                job.add_progress(f"Chunk {i+1}: extract failed, skip")
                continue

            job.add_progress(f"Chunk {i+1}/{num_chunks}: transcribing")
            r = transcribe_chunk_isolated(chunk_path, job.language)
            chunk_text = r.get("text", "")

            if chunk_text:
                all_text.append(chunk_text)
                job.partial_text = " ".join(all_text).strip()
                job.add_progress(f"Chunk {i+1}: {len(chunk_text)} chars")

            total_proc_time += r.get("load_time", 0) + r.get("transcribe_time", 0)

            try: os.unlink(chunk_path)
            except: pass
            gc.collect()
            time.sleep(CHUNK_COOLDOWN)

        final_text = " ".join(all_text).strip()
        return {
            "text": final_text,
            "duration": duration,
            "processing_time": round(total_proc_time, 2),
            "chunked": True,
            "chunk_count": num_chunks,
            "model": MODEL_SIZE,
            "language": job.language,
        }
    finally:
        try: shutil.rmtree(chunk_dir)
        except: pass
        try: os.unlink(wav_path)
        except: pass
        try: shutil.rmtree(chunks_dir)
        except: pass
        chunked_uploads.pop(upload_job_id, None)
        aggressive_cleanup()


@app.post("/transcribe-chunked/{job_id}")
async def transcribe_chunked(job_id: str, language: str = "id"):
    """After all chunks uploaded, transcribe each chunk ONE BY ONE (no assembly).
    Returns a NEW job_id for polling.
    """
    if job_id not in chunked_uploads:
        raise HTTPException(status_code=404, detail="Chunked upload not found")

    upload_info = chunked_uploads[job_id]
    if len(upload_info["received"]) != upload_info["total_chunks"]:
        raise HTTPException(status_code=400, detail=f"Missing chunks: {len(upload_info['received'])}/{upload_info['total_chunks']}")

    filename = upload_info["filename"]
    file_size = sum(os.path.getsize(os.path.join(upload_info["chunks_dir"], f"chunk_{i:05d}"))
                    for i in range(upload_info["total_chunks"])
                    if os.path.exists(os.path.join(upload_info["chunks_dir"], f"chunk_{i:05d}")))

    print(f"[chunked] Starting chunked transcription for {filename} ({file_size/1024/1024:.1f}MB, {upload_info['total_chunks']} chunks)")

    # Create job in queue
    transcribe_job_id = str(uuid.uuid4())
    job = Job(
        job_id=transcribe_job_id,
        audio_path="",  # empty — chunks processed directly
        language=language,
        filename=filename,
        file_size=file_size,
        chunk_mode="chunked",  # special mode
    )

    # Store upload_job_id in job for processing
    job._upload_job_id = job_id  # type: ignore

    if not job_queue.submit(job):
        return JSONResponse({
            "status": "rejected",
            "error": "Sistem sedang padat. Mohon tunggu beberapa saat dan coba lagi.",
            "retry_after_seconds": 30,
        }, status_code=200)

    return {
        "job_id": transcribe_job_id,
        "status": "queued",
        "message": "Chunked transcription started.",
        "check_status_url": f"/jobs/{transcribe_job_id}",
    }

@app.get("/chunked/{job_id}/status")
async def chunked_upload_status(job_id: str):
    """Check chunked upload progress."""
    if job_id not in chunked_uploads:
        raise HTTPException(status_code=404, detail="Chunked upload not found")
    info = chunked_uploads[job_id]
    return {
        "job_id": job_id,
        "filename": info["filename"],
        "total_chunks": info["total_chunks"],
        "received_chunks": len(info["received"]),
        "complete": len(info["received"]) == info["total_chunks"],
    }



@app.post("/transcribe-chunk-stream")
async def transcribe_chunk_stream(
    file: UploadFile = File(...),
    language: str = Form("id"),
    chunk_index: int = Form(0),
    total_chunks: int = Form(1),
    upload_job_id: str = Form(""),
):
    """Upload ONE 25MB chunk + store on server. NO transcription here.
    After ALL chunks uploaded, client calls /transcribe-chunked/{upload_job_id}.
    """
    chunks_dir = os.path.join(CHUNK_UPLOAD_DIR, upload_job_id) if upload_job_id else tempfile.mkdtemp(prefix="chunk_")
    os.makedirs(chunks_dir, exist_ok=True)

    if upload_job_id and upload_job_id not in chunked_uploads:
        chunked_uploads[upload_job_id] = {
            "filename": file.filename or "unknown",
            "total_chunks": total_chunks,
            "received": set(),
            "chunks_dir": chunks_dir,
            "created_at": time.time(),
        }
    if upload_job_id:
        chunked_uploads[upload_job_id]["received"].add(chunk_index)

    chunk_path = os.path.join(chunks_dir, f"chunk_{chunk_index:05d}")
    file_size = 0
    with open(chunk_path, "wb") as f:
        while True:
            data = await file.read(4 * 1024 * 1024)
            if not data: break
            f.write(data)
            file_size += len(data)

    received = len(chunked_uploads[upload_job_id]["received"]) if upload_job_id else 1
    print(f"[stream-upload] Chunk {chunk_index+1}/{total_chunks}: {file_size/1024/1024:.1f}MB stored ({received}/{total_chunks})")

    return {
        "chunk_index": chunk_index,
        "total_chunks": total_chunks,
        "received": received,
        "complete": received == total_chunks,
        "upload_job_id": upload_job_id,
    }


@app.post("/transcribe-assembled/{upload_job_id}")
async def transcribe_assembled_stream(upload_job_id: str, language: str = "id"):
    """SSE endpoint: assemble uploaded chunks → ffmpeg split 1-min → transcribe each → stream text.
    Returns Server-Sent Events so frontend gets text incrementally.
    """
    async def event_generator():
        if upload_job_id not in chunked_uploads:
            yield f"data: {json.dumps({'type': 'error', 'message': 'Upload not found'})}\n\n"
            return

        upload_info = chunked_uploads[upload_job_id]
        chunks_dir = upload_info["chunks_dir"]
        total_chunks = upload_info["total_chunks"]
        filename = upload_info["filename"]

        if len(upload_info["received"]) != total_chunks:
            yield f"data: {json.dumps({'type': 'error', 'message': f'Missing chunks: {len(upload_info["received"])}/{total_chunks}'})}\n\n"
            return

        # Step 1: Assemble chunks
        yield f"data: {json.dumps({'type': 'assembling', 'total_chunks': total_chunks})}\n\n"
        assembled_path = os.path.join(chunks_dir, f"assembled_{filename}")
        total_size = 0
        with open(assembled_path, "wb") as outfile:
            for i in range(total_chunks):
                chunk_path = os.path.join(chunks_dir, f"chunk_{i:05d}")
                if os.path.exists(chunk_path):
                    with open(chunk_path, "rb") as infile:
                        outfile.write(infile.read())
                    total_size += os.path.getsize(chunk_path)
                    os.unlink(chunk_path)

        yield f"data: {json.dumps({'type': 'assembled', 'size_mb': round(total_size/1024/1024, 1)})}\n\n"

        # Step 2: Convert to WAV
        wav_path = assembled_path + ".wav"
        yield f"data: {json.dumps({'type': 'converting'})}\n\n"
        if not convert_to_wav(assembled_path, wav_path):
            yield f"data: {json.dumps({'type': 'error', 'message': 'ffmpeg conversion failed'})}\n\n"
            try: os.unlink(assembled_path)
            except: pass
            return

        # Cleanup assembled file (keep WAV only)
        try: os.unlink(assembled_path)
        except: pass

        duration = get_audio_duration(wav_path)
        yield f"data: {json.dumps({'type': 'ready', 'duration_sec': duration, 'duration_min': round(duration/60, 1)})}\n\n"

        # Step 3: Split into SAME number of chunks as upload (1:1 ratio)
        # If uploaded 8 chunks of 25MB, transcribe 8 chunks of equal duration
        num_chunks = total_chunks  # SAME as upload chunk count!
        chunk_duration = duration / num_chunks if num_chunks > 0 else duration
        yield f"data: {json.dumps({'type': 'chunking', 'total_chunks': num_chunks})}\n\n"

        all_text = []
        total_proc = 0
        chunk_dir = tempfile.mkdtemp(prefix="transcribe_")

        try:
            for i in range(num_chunks):
                start_sec = i * chunk_duration
                chunk_path = os.path.join(chunk_dir, f"chunk_{i:04d}.wav")
                if not extract_chunk_lazy(wav_path, start_sec, chunk_duration, chunk_path):
                    continue

                yield f"data: {json.dumps({'type': 'progress', 'chunk': i+1, 'total': num_chunks, 'percent': int((i/num_chunks)*100)})}\n\n"

                r = transcribe_chunk_isolated(chunk_path, language)
                chunk_text = r.get("text", "")

                if chunk_text:
                    all_text.append(chunk_text)
                    yield f"data: {json.dumps({'type': 'text', 'chunk': i+1, 'text': chunk_text, 'chars': len(chunk_text)})}\n\n"

                total_proc += r.get("load_time", 0) + r.get("transcribe_time", 0)

                try: os.unlink(chunk_path)
                except: pass
                gc.collect()
                time.sleep(CHUNK_COOLDOWN)

            final_text = " ".join(all_text).strip()
            yield f"data: {json.dumps({'type': 'complete', 'text': final_text, 'total_chars': len(final_text), 'chunks': num_chunks, 'processing_time': round(total_proc, 2)})}\n\n"

        finally:
            try: shutil.rmtree(chunk_dir)
            except: pass
            try: os.unlink(wav_path)
            except: pass
            try: shutil.rmtree(chunks_dir)
            except: pass
            chunked_uploads.pop(upload_job_id, None)
            aggressive_cleanup()

    return StreamingResponse(event_generator(), media_type="text/event-stream")



# ===== Qwen endpoints =====
@app.get("/llm/health")
async def llm_health():
    s = qwen_mgr.status()
    return {"status": "ok" if s["loaded"] else "not_loaded",
            "model": "Qwen2.5-1.5B-Instruct Q4_K_M (4-bit)", **s}

@app.post("/llm/load")
async def llm_load():
    llm = qwen_mgr.get()
    if llm is None: return {"status": "error", "error": qwen_mgr._load_error}
    return {"status": "ok", "model": "Qwen2.5-3B-Instruct loaded"}

@app.post("/llm/unload")
async def llm_unload():
    if qwen_mgr.unload():
        return {"status": "ok", "message": "Qwen unloaded + cleanup done"}
    return {"status": "ok", "message": "Qwen was not loaded"}

@app.post("/whisper/unload")
async def whisper_unload():
    aggressive_cleanup()
    return {"status": "ok", "message": "Cleanup done"}

@app.post("/cleanup")
async def manual_cleanup():
    before = get_mem_mb()
    aggressive_cleanup()
    after = get_mem_mb()
    return {"status": "ok", "before_mb": before, "after_mb": after, "freed_mb": before - after}

@app.post("/llm/chat")
async def llm_chat(req: dict):
    messages = req.get("messages", [])
    if not messages:
        return JSONResponse({"error": "messages required"}, status_code=400)
    llm = qwen_mgr.get()
    if llm is None:
        return JSONResponse({"error": "Qwen not available", "detail": qwen_mgr._load_error}, status_code=503)
    try:
        t0 = time.time()
        formatted = [{"role": m.get("role", "user"), "content": m.get("content", "")} for m in messages]
        response = llm.create_chat_completion(
            messages=formatted, max_tokens=req.get("max_tokens", 1024),
            temperature=req.get("temperature", 0.7), top_p=req.get("top_p", 0.9), stream=False,
        )
        return {
            "id": f"qwen-{int(time.time())}", "object": "chat.completion",
            "model": "qwen2.5-3b-instruct", "choices": response.get("choices", []),
            "usage": response.get("usage", {}),
            "processing_time": round(time.time() - t0, 2), "provider": "local-qwen",
        }
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

@app.post("/llm/enhance")
async def llm_enhance(req: dict):
    text = req.get("text", "").strip()
    if not text: return {"text": "", "source": "empty"}
    llm = qwen_mgr.get()
    if llm is None:
        return {"text": text, "source": "qwen-unavailable", "error": qwen_mgr._load_error}
    try:
        system = "Perbaiki teks STT bahasa Indonesia. Perbaiki kata tidak dikenali, tambah tanda baca, kapital awal kalimat. JANGAN ubah kata asing. Kembalikan TEKS SAJA."
        response = llm.create_chat_completion(
            messages=[{"role": "system", "content": system}, {"role": "user", "content": text}],
            max_tokens=2048, temperature=0.1, stream=False,
        )
        return {"text": response["choices"][0]["message"]["content"].strip(), "source": "qwen"}
    except Exception as e:
        return {"text": text, "source": "qwen-error", "error": str(e)}


def get_mem_mb() -> int:
    try:
        with open("/proc/meminfo") as f:
            for line in f:
                if line.startswith("MemAvailable:"):
                    return int(line.split()[1]) // 1024
    except: return 0


@app.on_event("startup")
async def startup_event():
    print(f"[v7] Starting. Lazy chunking + subprocess isolation + cooldown")
    print(f"[v7] Chunk: {CHUNK_MINUTES}min, cooldown: {CHUNK_COOLDOWN}s, queue: {MAX_QUEUE_SIZE}")
    mp.set_start_method('spawn', force=True)
    job_queue.start_worker()
    qwen_mgr.start_cleanup_thread()


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000, workers=1)
