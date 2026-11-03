const DEV_MODE_STORAGE_KEY = "conscious_tech_dev_mode";

/**
 * Returns true if dev mode is enabled via `?dev=1` in query string or persisted in sessionStorage.
 */
export function isDevMode(): boolean {
  try {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("dev") === "1") {
        sessionStorage.setItem(DEV_MODE_STORAGE_KEY, "1");
        return true;
      }
      return sessionStorage.getItem(DEV_MODE_STORAGE_KEY) === "1";
    }
    if (
      typeof globalThis !== "undefined" &&
      (globalThis as unknown as { __DEV_MODE__?: boolean }).__DEV_MODE__ !== undefined
    ) {
      return Boolean((globalThis as unknown as { __DEV_MODE__?: boolean }).__DEV_MODE__);
    }
    return false;
  } catch {
    return false;
  }
}

export function setDevModeForTesting(enabled: boolean | null): void {
  if (typeof globalThis !== "undefined") {
    if (enabled === null) {
      delete (globalThis as unknown as { __DEV_MODE__?: boolean }).__DEV_MODE__;
    } else {
      (globalThis as unknown as { __DEV_MODE__?: boolean }).__DEV_MODE__ = enabled;
    }
  }
}
