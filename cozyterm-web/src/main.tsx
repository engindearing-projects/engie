import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { applyUrlParams } from './services/autoConnect';
import App from './App';

// Read token/host/port from URL params (if present), save to localStorage, strip URL
applyUrlParams();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
