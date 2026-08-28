/**
 * Kamerabasert strekkodeskanning.
 *
 * Bruker nettleserens innebygde BarcodeDetector når den finnes (Chrome på
 * Android er raskest der), og faller ellers tilbake på ZXing – som blant
 * annet dekker Safari på iPhone/iPad.
 */

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'];

export function hasCameraSupport() {
  return Boolean(navigator.mediaDevices?.getUserMedia);
}

async function nativeDetectorSupported() {
  if (!('BarcodeDetector' in globalThis)) return false;
  try {
    const supported = await globalThis.BarcodeDetector.getSupportedFormats();
    return supported.some((f) => FORMATS.includes(f));
  } catch {
    return false;
  }
}

export class BarcodeScanner {
  constructor(videoEl) {
    this.video = videoEl;
    this.stream = null;
    this.running = false;
    this.controls = null;
    this.rafId = null;
    this.lastHit = { code: '', ts: 0 };
    this.deviceId = null;
  }

  /** Kameraer på enheten, slik at brukeren kan velge bakkamera manuelt. */
  async listCameras() {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'videoinput');
  }

  /**
   * Starter kameraet og kaller `onResult(kode)` for hvert treff.
   * Samme kode ignoreres i `debounceMs` for å unngå dobbeltregistrering.
   */
  async start(onResult, { onError, deviceId = null, debounceMs = 1500 } = {}) {
    if (this.running) await this.stop();
    this.running = true;
    this.deviceId = deviceId;
    this.debounceMs = debounceMs;

    const constraints = {
      audio: false,
      video: deviceId
        ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
        : { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    };

    this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    this.video.srcObject = this.stream;
    this.video.setAttribute('playsinline', 'true');
    await this.video.play();

    const emit = (code) => {
      const now = Date.now();
      if (code === this.lastHit.code && now - this.lastHit.ts < this.debounceMs) return;
      this.lastHit = { code, ts: now };
      onResult(code);
    };

    if (await nativeDetectorSupported()) {
      await this.#runNative(emit, onError);
    } else {
      await this.#runZxing(emit, onError);
    }
  }

  async #runNative(emit, onError) {
    const detector = new globalThis.BarcodeDetector({ formats: FORMATS });
    const tick = async () => {
      if (!this.running) return;
      try {
        if (this.video.readyState >= 2) {
          const codes = await detector.detect(this.video);
          if (codes.length) emit(codes[0].rawValue);
        }
      } catch (err) {
        onError?.(err);
      }
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  async #runZxing(emit, onError) {
    const { BrowserMultiFormatReader } = await import('@zxing/browser');
    const reader = new BrowserMultiFormatReader();
    this.controls = await reader.decodeFromStream(this.stream, this.video, (result, err) => {
      if (result) emit(result.getText());
      // ZXing melder "ikke funnet" for hver rute uten treff – det er normalt.
      else if (err && err.name !== 'NotFoundException') onError?.(err);
    });
  }

  /** Skrur lommelykta av/på der maskinvaren støtter det. */
  async toggleTorch(on) {
    const track = this.stream?.getVideoTracks?.()[0];
    if (!track) return false;
    const caps = track.getCapabilities?.() || {};
    if (!caps.torch) return false;
    await track.applyConstraints({ advanced: [{ torch: Boolean(on) }] });
    return true;
  }

  async stop() {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    try {
      this.controls?.stop();
    } catch {
      /* allerede stoppet */
    }
    this.controls = null;
    for (const track of this.stream?.getTracks?.() || []) track.stop();
    this.stream = null;
    if (this.video) this.video.srcObject = null;
  }
}

/** Kort vibrasjon som kvittering på treff, der enheten støtter det. */
export function buzz(pattern = 60) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* ikke støttet */
  }
}

/** Kort pip via WebAudio – fungerer også når enheten står på lydløs vibrasjon. */
let audioCtx = null;
export function beep(ok = true) {
  try {
    const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctx) return;
    audioCtx = audioCtx || new Ctx();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = ok ? 880 : 220;
    gain.gain.value = 0.08;
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + (ok ? 0.09 : 0.22));
  } catch {
    /* lyd er valgfritt */
  }
}
