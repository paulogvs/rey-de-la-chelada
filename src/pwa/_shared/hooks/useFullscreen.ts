/**
 * useFullscreen — KDS fullscreen control (cocina/bar).
 *
 * requestFullscreen requiere un gesto del usuario; por eso el toggle
 * se invoca desde el botón "Pantalla completa" del header KDS.
 * Fallback webkit para Safari/iOS.
 */

import { useCallback, useEffect, useState } from 'react';

interface FullscreenDocument extends Document {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
}

interface FullscreenElement extends HTMLElement {
  webkitRequestFullscreen?: () => void;
}

export function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => {
      const doc = document as FullscreenDocument;
      setIsFullscreen(Boolean(document.fullscreenElement || doc.webkitFullscreenElement));
    };
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, []);

  const toggleFullscreen = useCallback(() => {
    const doc = document as FullscreenDocument;
    const el = document.documentElement as FullscreenElement;

    if (document.fullscreenElement || doc.webkitFullscreenElement) {
      if (document.exitFullscreen) {
        void document.exitFullscreen();
      } else if (doc.webkitExitFullscreen) {
        doc.webkitExitFullscreen();
      }
    } else {
      if (el.requestFullscreen) {
        void el.requestFullscreen();
      } else if (el.webkitRequestFullscreen) {
        el.webkitRequestFullscreen();
      }
    }
  }, []);

  return { isFullscreen, toggleFullscreen };
}

export default useFullscreen;
