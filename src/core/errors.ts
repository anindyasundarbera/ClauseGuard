/**
 * Shared fail-closed privacy and compliance boundary error class.
 */
export class PrivacyBoundaryError extends Error {
  public readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
    this.name = "PrivacyBoundaryError";
  }
}
