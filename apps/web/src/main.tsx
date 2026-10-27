// First: zod's settings must be in place before any module makes a schema.
import './zod-setup';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { loadSlots } from './slots';
import './index.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing the #root element in index.html');

await loadSlots();

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
