export class RareApiError extends Error {
  readonly status: number;
  readonly path: string;
  readonly details: unknown;

  constructor(message: string, status: number, path: string, details?: unknown) {
    super(`API error ${status} on ${path}: ${message}`);
    this.name = 'RareApiError';
    this.status = status;
    this.path = path;
    this.details = details;
  }
}
