export class CaptureEngine {
  constructor({ onFrame, targetFps = 24 }) {
    this.onFrame = onFrame;
    this.targetFps = targetFps;
    this.stream = null;
    this.video = null;
    this.canvas = null;
    this.ctx = null;
    this.animFrameId = null;
    this.cropRegion = null; // { x, y, width, height } in source pixels
    this.sourceSize = { width: 1920, height: 1080 };
    this._lastTime = 0;
    this._interval = 1000 / targetFps;
  }

  async start(sourceId) {
    this.stop();

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
          maxWidth: 1920,
          maxHeight: 1080,
        },
      },
    });

    this.video = document.createElement('video');
    this.video.srcObject = this.stream;
    this.video.muted = true;
    await this.video.play();

    this.canvas = new OffscreenCanvas(
      this.video.videoWidth || 1920,
      this.video.videoHeight || 1080
    );
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });

    this.sourceSize = {
      width: this.video.videoWidth,
      height: this.video.videoHeight,
    };

    this._loop(0);
  }

  setRegion(region) {
    // region: { x, y, width, height } normalised 0..1 relative to source size
    if (!region) {
      this.cropRegion = null;
      return;
    }
    this.cropRegion = {
      x: Math.round(region.x * this.sourceSize.width),
      y: Math.round(region.y * this.sourceSize.height),
      width: Math.round(region.width * this.sourceSize.width),
      height: Math.round(region.height * this.sourceSize.height),
    };
  }

  setFps(fps) {
    this.targetFps = fps;
    this._interval = 1000 / fps;
  }

  _loop(timestamp) {
    this.animFrameId = requestAnimationFrame((t) => this._loop(t));

    if (timestamp - this._lastTime < this._interval) return;
    this._lastTime = timestamp;

    if (!this.video || this.video.readyState < 2) return;

    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;

    // Update canvas size if video dimensions changed
    if (this.canvas.width !== vw || this.canvas.height !== vh) {
      this.canvas.width = vw;
      this.canvas.height = vh;
      this.sourceSize = { width: vw, height: vh };
    }

    this.ctx.drawImage(this.video, 0, 0, vw, vh);

    let cropX = 0, cropY = 0, cropW = vw, cropH = vh;
    if (this.cropRegion) {
      cropX = Math.max(0, this.cropRegion.x);
      cropY = Math.max(0, this.cropRegion.y);
      cropW = Math.min(this.cropRegion.width, vw - cropX);
      cropH = Math.min(this.cropRegion.height, vh - cropY);
    }

    if (cropW <= 0 || cropH <= 0) return;

    // getImageData allocates a fresh buffer each call, so this one can be
    // handed straight to the worker as a transferable — no copy needed.
    const imageData = this.ctx.getImageData(cropX, cropY, cropW, cropH);
    this.onFrame({ buffer: imageData.data.buffer, width: cropW, height: cropH });
  }

  stop() {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    this.video = null;
    this.canvas = null;
    this.ctx = null;
    this.cropRegion = null;
  }
}
