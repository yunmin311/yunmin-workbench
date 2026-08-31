import React from 'react';
import { createRoot } from 'react-dom/client';
import { AmbientIsland } from './components/AmbientIsland';

const container = document.getElementById('island-root');
if (container) {
  const root = createRoot(container);
  root.render(<AmbientIsland />);
} else {
  console.error('Island root container not found');
}