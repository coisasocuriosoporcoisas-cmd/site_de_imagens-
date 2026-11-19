import test from "node:test";
import assert from "node:assert/strict";
import { escapeHtml, normalizeTag, validImage, verifyTotp } from "../worker/index.js";

test("normalizes tags into stable display names and slugs", () => {
  assert.deepEqual(normalizeTag(" #Árvore   do Sol "), {
    name: "árvore do sol",
    slug: "arvore-do-sol",
  });
});

test("escapes all HTML-sensitive characters", () => {
  assert.equal(escapeHtml(`<img src="x" onerror='bad'>`), "&lt;img src=&quot;x&quot; onerror=&#39;bad&#39;&gt;");
});

test("recognizes supported image signatures and rejects other input", () => {
  assert.equal(validImage(Uint8Array.from([255, 216, 255, 0])).type, "image/jpeg");
  assert.equal(validImage(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])).type, "image/png");
  assert.equal(validImage(Uint8Array.from([71, 73, 70, 56, 57, 97])).type, "image/gif");
  assert.equal(validImage(Uint8Array.from([0, 1, 2])), null);
});

test("verifies the six-digit RFC 6238 test vector", async () => {
  assert.equal(await verifyTotp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", "287082", 59_000), true);
  assert.equal(await verifyTotp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", "000000", 59_000), false);
});
