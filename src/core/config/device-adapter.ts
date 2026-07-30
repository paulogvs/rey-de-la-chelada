/**
 * DeviceAdapter — Detect screen size, touch capability, orientation
 *
 * SSOT for device detection across all PWAs.
 * Each PWA uses this to adjust layout gracefully.
 *
 * Artículo II: ZERO HARDCODED — No magic breakpoints in components.
 */

export type DeviceClass = 'phone' | 'tablet' | 'desktop' | 'kds';
export type Orientation = 'portrait' | 'landscape';
export type InputMethod = 'touch' | 'mouse' | 'hybrid';

export interface DeviceInfo {
  /** Device class based on screen width */
  deviceClass: DeviceClass;
  /** Current orientation */
  orientation: Orientation;
  /** Primary input method */
  inputMethod: InputMethod;
  /** Screen width in pixels */
  width: number;
  /** Screen height in pixels */
  height: number;
  /** Pixel ratio */
  pixelRatio: number;
  /** Whether the device supports touch */
  isTouch: boolean;
  /** Whether the device is likely a KDS (fullscreen + landscape) */
  isKDS: boolean;
  /** Whether reduced motion is preferred */
  prefersReducedMotion: boolean;
}

/**
 * Get current device information
 */
export function getDeviceInfo(): DeviceInfo {
  if (typeof window === 'undefined') {
    return {
      deviceClass: 'desktop',
      orientation: 'landscape',
      inputMethod: 'mouse',
      width: 1024,
      height: 768,
      pixelRatio: 1,
      isTouch: false,
      isKDS: false,
      prefersReducedMotion: false,
    };
  }

  const width = window.innerWidth;
  const height = window.innerHeight;
  const pixelRatio = window.devicePixelRatio || 1;
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Detect KDS: fullscreen + landscape + no chrome
  const isKDS = document.documentElement.dataset.pwa === 'cocina' || document.documentElement.dataset.pwa === 'bar';

  // Determine device class
  let deviceClass: DeviceClass;
  if (width < 640) {
    deviceClass = 'phone';
  } else if (width < 1024) {
    deviceClass = 'tablet';
  } else if (isKDS) {
    deviceClass = 'kds';
  } else {
    deviceClass = 'desktop';
  }

  // Determine orientation
  const orientation: Orientation = width > height ? 'landscape' : 'portrait';

  // Determine input method
  let inputMethod: InputMethod;
  if (isTouch && width < 1024) {
    inputMethod = 'touch';
  } else if (!isTouch) {
    inputMethod = 'mouse';
  } else {
    inputMethod = 'hybrid';
  }

  return {
    deviceClass,
    orientation,
    inputMethod,
    width,
    height,
    pixelRatio,
    isTouch,
    isKDS,
    prefersReducedMotion: reducedMotion,
  };
}

/**
 * Hook to subscribe to device info changes
 */
export function useDeviceInfo(callback: (info: DeviceInfo) => void): () => void {
  if (typeof window === 'undefined') return () => {};

  const handler = () => callback(getDeviceInfo());

  window.addEventListener('resize', handler);
  window.addEventListener('orientationchange', handler);

  // Call immediately
  handler();

  return () => {
    window.removeEventListener('resize', handler);
    window.removeEventListener('orientationchange', handler);
  };
}

/**
 * Helper: get grid columns based on device class and module
 */
export function getGridColumns(deviceClass: DeviceClass, moduleId?: string): number {
  if (moduleId === 'cocina' || moduleId === 'bar') {
    switch (deviceClass) {
      case 'kds': return 4;
      case 'desktop': return 3;
      case 'tablet': return 2;
      default: return 1;
    }
  }

  switch (deviceClass) {
    case 'desktop': return 3;
    case 'tablet': return 2;
    default: return 1;
  }
}

/**
 * Helper: get font scale factor for device
 */
export function getFontScale(deviceClass: DeviceClass): number {
  switch (deviceClass) {
    case 'kds': return 1.5;
    case 'desktop': return 1;
    case 'tablet': return 1;
    case 'phone': return 0.875;
  }
}

export default getDeviceInfo;
