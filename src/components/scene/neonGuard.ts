/**
 * Neon akış donanım hızlandırması ister. Yazılım GL (SwiftShader, llvmpipe, Microsoft Basic Render)
 * ana iş parçacığını kilitler (kare başına yüzlerce ms): o cihazlarda efekt hiç başlamaz, sahne
 * durağan koyu zeminle kalır. Bilgi alınamazsa (tarayıcı gizliyorsa) izin verilir; çalışma anındaki
 * kare ölçümü (watchFrames) yine korur.
 */

let cached: boolean | null = null;

export function hardwareGraphics(): boolean {
  if (cached !== null) return cached;
  cached = true;
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) as WebGLRenderingContext | null;
    if (!gl) return (cached = false);
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "";
    if (/swiftshader|llvmpipe|softpipe|software|basic render/i.test(name)) cached = false;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    cached = true;
  }
  return cached;
}

/**
 * Isınmadan sonra kare hızını ölçer; ortalama minFps'in altındaysa onSlow çağrılır (bir kez).
 * Sekme gizliyken ölçmez. Temizleme fonksiyonu döner.
 */
export function watchFrames(onSlow: () => void, { warmMs = 1200, windowMs = 1800, minFps = 24 } = {}): () => void {
  let raf = 0;
  let start = 0;
  let frames = 0;
  let stopped = false;
  const t0 = performance.now();
  const tick = (t: number) => {
    if (stopped) return;
    if (document.visibilityState !== "visible") {
      start = 0;
      frames = 0;
    } else if (t - t0 >= warmMs) {
      if (!start) start = t;
      frames++;
      const span = t - start;
      if (span >= windowMs) {
        if ((frames * 1000) / span < minFps) onSlow();
        return;
      }
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
  };
}
