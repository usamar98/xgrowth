import { del, get, list, put } from "@vercel/blob";

export function vercelMediaBucket(
  token = process.env.BLOB_READ_WRITE_TOKEN,
  storeId = process.env.BLOB_STORE_ID,
) {
  if (!token && !storeId) return undefined;
  const auth = token ? { token } : { storeId };

  return {
    async put(
      key: string,
      bytes: Uint8Array,
      { httpMetadata }: { httpMetadata: { contentType: string } },
    ) {
      await put(key, Buffer.from(bytes), {
        ...auth,
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType: httpMetadata.contentType,
      });
    },

    async get(key: string) {
      const result = await get(key, { ...auth, access: "private" });
      if (result?.statusCode !== 200) return null;
      return {
        body: result.stream,
        httpMetadata: { contentType: result.blob.contentType },
      };
    },

    async list(options: { prefix: string; cursor?: string; limit: number }) {
      const page = await list({ ...options, ...auth });
      return {
        objects: page.blobs.map(({ pathname }) => ({ key: pathname })),
        truncated: page.hasMore,
        cursor: page.cursor,
      };
    },

    async delete(keys: string | string[]) {
      await del(keys, auth);
    },
  };
}
