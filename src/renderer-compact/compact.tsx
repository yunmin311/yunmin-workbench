import React from 'react';
import { createRoot } from 'react-dom/client';
import { CompactApp } from './CompactApp';
import './compact.css';

const container = document.getElementById('compact-root');
if (container) {
  createRoot(container).render(<CompactApp />);
} else {
  console.error('compact root container not found');
}
