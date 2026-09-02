import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { MaterialProvider } from './material/MaterialProvider';
import './material/material-surfaces.css';
import './product-rebuild.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <MaterialProvider>
        <App />
      </MaterialProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
