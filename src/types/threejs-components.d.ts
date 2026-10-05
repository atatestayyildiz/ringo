// threejs-components paketinin tür tanımı yok; yalnız kullandığımız yüzey.
declare module "threejs-components/build/cursors/tubes1.min.js" {
  type TubesOptions = {
    tubes?: { colors?: string[]; lights?: { intensity?: number; colors?: string[] } };
    bloom?: { threshold?: number; strength?: number; radius?: number } | false;
  };
  export type TubesApp = {
    tubes: { setColors(colors: string[]): void; setLightsColors(colors: string[]): void };
    three: {
      renderer: { setAnimationLoop(cb: (() => void) | null): void };
      resize(): void;
      isDisposed: boolean;
    };
    dispose(): void;
  };
  export default function TubesCursor(canvas: HTMLCanvasElement, options?: TubesOptions): TubesApp;
}
