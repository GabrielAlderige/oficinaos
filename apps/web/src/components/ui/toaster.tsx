import { useSyncExternalStore } from 'react';
import { Toaster as Sonner } from 'sonner';
import { useTheme } from '../../lib/theme';

const SMALL_SCREEN = '(max-width: 640px)';

function subscribe(onChange: () => void) {
  const media = matchMedia(SMALL_SCREEN);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

/** No celular os avisos saem embaixo (perto do polegar, sem cobrir o cabeçalho). */
export function Toaster() {
  const { theme } = useTheme();
  const small = useSyncExternalStore(subscribe, () => matchMedia(SMALL_SCREEN).matches, () => false);
  return <Sonner theme={theme} position={small ? 'bottom-center' : 'top-right'} richColors closeButton />;
}
