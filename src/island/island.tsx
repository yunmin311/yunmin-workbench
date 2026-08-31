import React from 'react';
import { createRoot } from 'react-dom/client';
import { AmbientIsland } from './components/AmbientIsland';
import { useIslandMaterial } from './IslandMaterialProvider';
import '../renderer/src/material/material-surfaces.css';
import '../renderer/src/material/product-integration.css';

function IslandApp() {
  useIslandMaterial();
  return <AmbientIsland />;
}

const container = document.getElementById('island-root');
if (container) {
  const root = createRoot(container);
  root.render(<IslandApp />);
} else {
  console.error('Island root container not found');
}