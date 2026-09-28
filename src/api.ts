export function getBackendUrl(): string {
  const envUrl = (import.meta as any).env?.VITE_BACKEND_URL;
  if (envUrl && typeof envUrl === 'string' && envUrl.trim()) return envUrl.replace(/\/$/, '');
  return 'http://localhost:8000';
}
