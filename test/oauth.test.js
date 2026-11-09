import test from "node:test";
import assert from "node:assert/strict";
import worker, { constantTimeEqual, readCookie } from "../src/index.js";

test("constantTimeEqual accepts equal 256-bit base64url states", () => {
  const state = "a".repeat(43);
  assert.equal(constantTimeEqual(state, state), true);
});

test("constantTimeEqual rejects different values and invalid lengths", () => {
  assert.equal(constantTimeEqual("a".repeat(43), "b".repeat(43)), false);
  assert.equal(constantTimeEqual("short", "short"), false);
  assert.equal(constantTimeEqual(null, "a".repeat(43)), false);
});

test("readCookie extracts a named cookie", () => {
  assert.equal(readCookie("a=1; __Host-cms_oauth_state=abc123; b=2", "__Host-cms_oauth_state"), "abc123");
});

test("readCookie returns null for missing cookie", () => {
  assert.equal(readCookie("a=1; b=2", "__Host-cms_oauth_state"), null);
  assert.equal(readCookie(null, "anything"), null);
});

test("health endpoint is available without OAuth secrets", async () => {
  const response = await worker.fetch(new Request("https://oauth.example.workers.dev/health"), {});
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "ok");
});

test("unsupported providers are rejected", async () => {
  const response = await worker.fetch(new Request("https://oauth.example.workers.dev/auth?provider=gitlab"), {});
  assert.equal(response.status, 400);
});

test("non-GET requests are rejected", async () => {
  const response = await worker.fetch(new Request("https://oauth.example.workers.dev/health", { method: "POST" }), {});
  assert.equal(response.status, 405);
});
