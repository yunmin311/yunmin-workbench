/** Stable, explicit identities for external files used by Packet validity. */
export function normalizeSourcePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

export function overlayFileSourceRef(relativePath: string): string {
  return `overlay:${normalizeSourcePath(relativePath)}`;
}

export function projectFileSourceRef(projectId: string, relativePath: string): string {
  return `project-file:${projectId}:${normalizeSourcePath(relativePath)}`;
}
