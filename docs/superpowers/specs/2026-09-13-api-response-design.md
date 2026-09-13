# API Response Contract

All API endpoints return a stable envelope with `success`, `code`, `message`, `data`, and `meta`. `meta` contains `requestId`, `timestamp`, `path`, and `durationMs`. A global interceptor creates success responses and logs method, path, status, request ID, and duration. A global exception filter creates the same envelope for HTTP and unknown errors, logs the full server error, and exposes only safe error details. The web API client unwraps `data` and includes the request ID in thrown errors.
