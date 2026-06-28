'use strict';

/**
 * Standardized error handling (foundation for Step 23).
 * Every known failure maps to one of the required error codes.
 */

const HTTP_STATUS = {
  TEMPLATE_NOT_FOUND: 404,
  TEMPLATE_VERSION_NOT_FOUND: 404,
  NO_PUBLISHED_VERSION: 409,
  INVALID_LAYOUT_JSON: 422,
  INVALID_INPUT_DATA: 400,
  MISSING_REQUIRED_FIELD: 422,
  TABLE_BINDING_NOT_ARRAY: 422,
  PDF_RENDERING_FAILED: 500,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  GENERATION_LIMIT_EXCEEDED: 429,
  INTERNAL_ERROR: 500
};

class AppError extends Error {
  /**
   * @param {string} code one of the standardized error codes
   * @param {string} message human readable message
   * @param {Array<object>} [details] structured details, e.g. missing bindings
   */
  constructor(code, message, details) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details || [];
    this.status = HTTP_STATUS[code] || 500;
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        details: this.details
      }
    };
  }
}

/** Express helper: send a structured error response */
function sendError(res, err) {
  if (err instanceof AppError) {
    return res.status(err.status).json(err.toJSON());
  }
  // eslint-disable-next-line no-console
  console.error('[pdf-form-builder] unexpected error:', err);
  return res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: err.message || 'Unexpected error', details: [] }
  });
}

/** CAP helper: convert an AppError into a request rejection */
function rejectWith(req, err) {
  if (err instanceof AppError) {
    return req.reject({
      code: err.code,
      status: err.status,
      message: err.message,
      details: err.details && err.details.length ? err.details : undefined
    });
  }
  throw err;
}

module.exports = { AppError, sendError, rejectWith, HTTP_STATUS };
