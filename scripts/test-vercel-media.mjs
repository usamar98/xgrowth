import assert from "node:assert/strict";
import { build } from "esbuild";

// Exercise the storage boundary without contacting a Vercel Blob store.
const calls = [];
const bytes = Uint8Array.of(1, 2, 3);
const key = "drafts/owner/image";
globalThis.fixtureBlob = {
  async put(...args) {
    calls.push(args);
  },
  async get(path, options) {
    calls.push([path, options]);
    if (path !== key) return null;
    return {
      statusCode: 200,
      stream: new Response(bytes).body,
      blob: { contentType: "image/png" },
    };
  },
  async list(options) {
    calls.push([options]);
    return { blobs: [{ pathname: key }], hasMore: true, cursor: "next" };
  },
  async del(...args) {
    calls.push(args);
  },
};
const bundle = await build({
  entryPoints: ["lib/vercel-media.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  plugins: [
    {
      name: "private-blob-fixture",
      setup(builder) {
        builder.onResolve({ filter: /^@vercel\/blob$/ }, () => ({
          namespace: "fixture",
          path: "blob",
        }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents:
            "export const { put, get, list, del } = globalThis.fixtureBlob;",
        }));
      },
    },
  ],
});
const { vercelMediaBucket } = await import(
  "data:text/javascript;base64," +
    Buffer.from(bundle.outputFiles[0].contents).toString("base64")
);
assert.equal(vercelMediaBucket("", ""), undefined);
await vercelMediaBucket("", "store_fixture").get(key);
assert.deepEqual(calls.pop(), [
  key,
  { storeId: "store_fixture", access: "private" },
]);
const token = "fixture-token";
const bucket = vercelMediaBucket(token);
await bucket.put(key, bytes, { httpMetadata: { contentType: "image/png" } });
assert.deepEqual(calls.pop(), [
  key,
  Buffer.from(bytes),
  {
    token,
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: false,
    contentType: "image/png",
  },
]);
const file = await bucket.get(key);
assert.deepEqual(calls.pop(), [key, { token, access: "private" }]);
assert.equal(file.httpMetadata.contentType, "image/png");
assert.deepEqual(
  new Uint8Array(await new Response(file.body).arrayBuffer()),
  bytes,
);
assert.equal(await bucket.get("drafts/owner/missing"), null);
const options = { prefix: "drafts/owner/", cursor: "previous", limit: 100 };
assert.deepEqual(await bucket.list(options), {
  objects: [{ key }],
  truncated: true,
  cursor: "next",
});
assert.deepEqual(calls.pop(), [{ ...options, token }]);
await bucket.delete([key]);
assert.deepEqual(calls.pop(), [[key], { token }]);
console.log(
  "PASS private Vercel Blob upload, authenticated read, unavailable storage and paginated cleanup",
);
