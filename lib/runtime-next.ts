import { getVercelDatabase } from "./vercel-database";
import { vercelMediaBucket } from "./vercel-media";

export const standalone = true;

// Build-time route discovery does not need production credentials. Resolve each
// binding when a request actually uses it, just as a Worker reads its bindings.
export const env = {
  get DB() {
    return getVercelDatabase();
  },
  get BUCKET() {
    return vercelMediaBucket();
  },
};
