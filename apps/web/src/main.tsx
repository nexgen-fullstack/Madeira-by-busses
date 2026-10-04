import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { lightStatusBar } from './lib/device.ts';
import { startPwa } from './lib/pwa.ts';
import './styles.css';

startPwa();
lightStatusBar();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
