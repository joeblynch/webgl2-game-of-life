'use strict';

const _workerSource = `
'use strict';
const CHUNK = 65536;
let bytesGenerated = 0;
let lastReport = performance.now();

self.onmessage = function(e) {
  if (e.data.type === 'fill') {
    const buf = e.data.buffer;
    const bytes = e.data.bytes;
    let offset = 0;
    while (offset < bytes) {
      const len = Math.min(CHUNK, bytes - offset);
      crypto.getRandomValues(new Int8Array(buf, offset, len));
      offset += len;
      bytesGenerated += len;
    }
    const now = performance.now();
    if (now - lastReport > 500) {
      self.postMessage({ type: 'stats', bytes: bytesGenerated });
      bytesGenerated = 0;
      lastReport = now;
    }
    self.postMessage({ type: 'frame', buffer: buf }, [buf]);
  }
};
`;

class EntropySource {
  constructor(maxBufferSize) {
    this._maxBufferSize = maxBufferSize;
    this._bytesPerSec = 0;

    // double-buffer state
    this._ready = null;       // filled buffer waiting to be consumed
    this._recyclable = null;  // previously consumed buffer, ready to send back to worker

    // pending consumeAsync resolve
    this._pendingResolve = null;
    this._pendingBytes = 0;

    // create worker from blob
    const blob = new Blob([_workerSource], { type: 'application/javascript' });
    this._workerURL = URL.createObjectURL(blob);
    this._worker = new Worker(this._workerURL);

    this._worker.onmessage = (e) => {
      if (e.data.type === 'frame') {
        this._ready = new Int8Array(e.data.buffer);
        if (this._pendingResolve) {
          const bytes = this._pendingBytes;
          const resolve = this._pendingResolve;
          this._pendingResolve = null;
          this._pendingBytes = 0;
          resolve(this._consume(bytes));
        }
      } else if (e.data.type === 'stats') {
        this._bytesPerSec = e.data.bytes * 2; // reported every 500ms
      }
    };

    // kick off first fill
    const buf = new ArrayBuffer(maxBufferSize);
    this._worker.postMessage({ type: 'fill', buffer: buf, bytes: maxBufferSize }, [buf]);
  }

  get bytesPerSec() {
    return this._bytesPerSec;
  }

  // internal: consume ready buffer and recycle the old one
  _consume(bytes) {
    const ready = this._ready;
    this._ready = null;

    // send a buffer to worker for the next fill (recycle old one, or allocate if first consume)
    const sendBuf = this._recyclable
      ? this._recyclable.buffer
      : new ArrayBuffer(this._maxBufferSize);
    this._worker.postMessage(
      { type: 'fill', buffer: sendBuf, bytes: this._maxBufferSize },
      [sendBuf]
    );
    this._recyclable = ready;

    return new Int8Array(ready.buffer, 0, bytes);
  }

  consume(bytes) {
    if (!this._ready) return null;
    return this._consume(bytes);
  }

  consumeAsync(bytes) {
    if (this._ready) {
      return Promise.resolve(this._consume(bytes));
    }
    return new Promise((resolve) => {
      this._pendingResolve = resolve;
      this._pendingBytes = bytes;
    });
  }

  destroy() {
    this._worker.terminate();
    URL.revokeObjectURL(this._workerURL);
    this._ready = null;
    this._recyclable = null;
    this._pendingResolve = null;
  }
}
