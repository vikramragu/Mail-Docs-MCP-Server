import { describe, it, expect, vi } from "vitest";
import {
  classifyGoogleError,
  withGoogleRetry,
  AuthRequiredError,
  DocumentNotFoundError,
  DocumentAccessError,
  InsufficientScopeError,
  GoogleUnavailableError,
} from "../../src/errors.js";

function errorWithStatus(status: number, message = "error"): Error & { response: { status: number } } {
  const err = new Error(message) as Error & { response: { status: number } };
  err.response = { status };
  return err;
}

describe("classifyGoogleError", () => {
  it("maps 401 to AuthRequiredError", () => {
    expect(classifyGoogleError(errorWithStatus(401))).toBeInstanceOf(AuthRequiredError);
  });

  it("maps 403 with scope message to InsufficientScopeError", () => {
    expect(classifyGoogleError(errorWithStatus(403, "insufficient scope"))).toBeInstanceOf(InsufficientScopeError);
  });

  it("maps a plain 403 to a generic error in the default (generic) context", () => {
    const err = classifyGoogleError(errorWithStatus(403, "forbidden"));
    expect(err).not.toBeInstanceOf(DocumentAccessError);
    expect(err.message).toBe("forbidden");
  });

  it("maps a plain 403 to DocumentAccessError in the 'documents' context", () => {
    expect(classifyGoogleError(errorWithStatus(403, "forbidden"), "documents")).toBeInstanceOf(DocumentAccessError);
  });

  it("maps a plain 404 to DocumentNotFoundError only in the 'documents' context", () => {
    expect(classifyGoogleError(errorWithStatus(404))).not.toBeInstanceOf(DocumentNotFoundError);
    expect(classifyGoogleError(errorWithStatus(404), "documents")).toBeInstanceOf(DocumentNotFoundError);
  });

  it("maps 429 and 5xx to GoogleUnavailableError", () => {
    expect(classifyGoogleError(errorWithStatus(429))).toBeInstanceOf(GoogleUnavailableError);
    expect(classifyGoogleError(errorWithStatus(503))).toBeInstanceOf(GoogleUnavailableError);
  });
});

describe("withGoogleRetry", () => {
  it("returns the result on success without retrying", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    await expect(withGoogleRetry(fn)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on 5xx up to maxRetries then succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(errorWithStatus(503))
      .mockRejectedValueOnce(errorWithStatus(503))
      .mockResolvedValue("ok");
    await expect(withGoogleRetry(fn, 3)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("gives up after maxRetries and throws a classified error", async () => {
    const fn = vi.fn().mockRejectedValue(errorWithStatus(503));
    await expect(withGoogleRetry(fn, 2)).rejects.toBeInstanceOf(GoogleUnavailableError);
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("does not retry non-retryable errors", async () => {
    const fn = vi.fn().mockRejectedValue(errorWithStatus(404));
    await expect(withGoogleRetry(fn, 3, "documents")).rejects.toBeInstanceOf(DocumentNotFoundError);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
