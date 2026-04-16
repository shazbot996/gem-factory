// Cross-context bridge: pushes the SPA's current auth state to the Chrome
// extension so the extension can piggyback on the SPA session when calling
// the API. See docs/specs/authentication-authorization-SPEC.md §3.2.
//
// The push is best-effort and completely silent on failure — the SPA must
// remain usable whether or not the extension is installed.

const EXTENSION_ID = import.meta.env.VITE_EXTENSION_ID;

export interface AuthPushPayload {
  token: string | null;       // null in dev bypass mode
  email: string;
  name: string;
  expiresAt: number | null;   // milliseconds since epoch; null for dev bypass
}

function canMessageExtension(): boolean {
  return (
    !!EXTENSION_ID &&
    typeof chrome !== 'undefined' &&
    !!chrome.runtime &&
    typeof chrome.runtime.sendMessage === 'function'
  );
}

export function pushAuthToExtension(payload: AuthPushPayload): void {
  if (!canMessageExtension()) return;
  try {
    chrome.runtime.sendMessage(
      EXTENSION_ID,
      { type: 'SET_AUTH', ...payload },
      () => {
        // Consume lastError so it doesn't surface as an uncaught message.
        // Extension not installed / message rejected is expected in many
        // environments and is not a failure mode we want to surface.
        void chrome.runtime.lastError;
      },
    );
  } catch {
    // Non-fatal
  }
}

export function clearAuthInExtension(): void {
  if (!canMessageExtension()) return;
  try {
    chrome.runtime.sendMessage(EXTENSION_ID, { type: 'CLEAR_AUTH' }, () => {
      void chrome.runtime.lastError;
    });
  } catch {
    // Non-fatal
  }
}
