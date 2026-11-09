import test from "node:test";
import assert from "node:assert/strict";
import { constantTimeEqual, readCookie } from "../src/index.js";

test("constantTimeEqual accepts equal values", () => {
  assert.equal(constantTimeEqual("same-state", "same-state"), true);
});

test("constantTimeEqual rejects different values and lengths", () => {
  assert.equal(constantTimeEqual("state-a", "state-b"), false);
  assert.equal(constantTimeEqual("short", "longer"), false);
  assert.equal(constantTimeEqual(null, "state"), false);
});

test("readCookie extracts a named cookie", () => {
  assert.equal(readCookie("a=1; __Host-cms_oauth_state=abc123; b=2", "__Host-cms_oauth_state"), "abc123");
});

test("readCookie returns null for missing cookie", () => {
  assert.equal(readCookie("a=1; b=2", "__Host-cms_oauth_state"), null);
  assert.equal(readCookie(null, "anything"), null);
});
