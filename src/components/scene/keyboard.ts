/**
 * Ekran klavyesi (mobil) yardımcıları. Kök düzende interactive-widget=resizes-visual: klavye yerleşim
 * görünür alanını değiştirmez, yalnız VisualViewport küçülür. Logo yerleşim alanına göre sabit kalır;
 * alt bölme (kart, PIN daireleri) klavye payı (--kb) kadar yukarı alınır.
 */

/** Klavyenin yerleşim alanının altından kapladığı yükseklik (px). */
export function keyboardInset(): number {
  const vv = typeof window !== "undefined" ? window.visualViewport : null;
  if (!vv) return 0;
  const inset = window.innerHeight - (vv.height + vv.offsetTop);
  return inset > 60 ? Math.round(inset) : 0;
}

/** Kök öğede --kb ve data-kb'yi klavyeyle eşitler; temizleme fonksiyonu döner. */
export function trackKeyboard(root: HTMLElement): () => void {
  const vv = window.visualViewport;
  if (!vv) return () => {};
  let raf = 0;
  const sync = () => {
    raf = 0;
    const kb = keyboardInset();
    root.style.setProperty("--kb", `${kb}px`);
    if (kb) root.dataset.kb = "";
    else delete root.dataset.kb;
  };
  const kick = () => {
    if (!raf) raf = requestAnimationFrame(sync);
  };
  vv.addEventListener("resize", kick);
  vv.addEventListener("scroll", kick);
  sync();
  return () => {
    if (raf) cancelAnimationFrame(raf);
    vv.removeEventListener("resize", kick);
    vv.removeEventListener("scroll", kick);
  };
}

/**
 * Klavyeyi kapatır (odaktaki alanı bırakır) ve görünür alan eski yüksekliğine dönene kadar bekler
 * (en fazla maxMs). Klavye açık değilse hemen döner.
 */
export function closeKeyboard(maxMs = 400): Promise<void> {
  const active = document.activeElement;
  if (active instanceof HTMLElement) active.blur();
  const vv = window.visualViewport;
  if (!vv || keyboardInset() === 0) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      vv.removeEventListener("resize", check);
      clearTimeout(timer);
      resolve();
    };
    const check = () => {
      if (keyboardInset() === 0) finish();
    };
    const timer = setTimeout(finish, maxMs);
    vv.addEventListener("resize", check);
  });
}
