export class RareApiError extends Error {
  readonly status: number;
  readonly path: string;
  readonly code?: string;
  readonly details?: ApiErrorField[];

  constructor(message: string, status: number, path: string, code?: string, details?: ApiErrorField[]) {
    super(`API error ${status} on ${path}: ${message}`);
    this.name = 'RareApiError';
    this.status = status;
    this.path = path;
    this.code = code;
    this.details = details;
  }
}

export type ApiErrorField = { field: string; message: string };

/** Parse additive application error fields without changing legacy messages. */
export function parseApiError(value: unknown): { error?: string; code?: string; details?: ApiErrorField[] } {
  if (typeof value !== 'object' || value === null) return {};
  const error = 'error' in value && typeof value.error === 'string' ? value.error : undefined;
  const code = 'code' in value && typeof value.code === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(value.code) ? value.code : undefined;
  const details = 'details' in value && Array.isArray(value.details) && value.details.every(isApiErrorField) ? value.details : undefined;
  return { ...(error === undefined ? {} : { error }), ...(code === undefined ? {} : { code }), ...(details === undefined ? {} : { details }) };
}

function isApiErrorField(value: unknown): value is ApiErrorField {
  return typeof value === 'object' && value !== null && 'field' in value && typeof value.field === 'string' && 'message' in value && typeof value.message === 'string';
}
