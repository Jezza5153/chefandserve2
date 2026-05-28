/**
 * Minimal R2 (S3-compatible) delete for workers — standalone, no Next.js deps.
 * Used by the retention worker to purge object bytes when a soft-deleted
 * chef_document passes its retention window. Degrades to null if R2 env is
 * absent so the worker can run DB-only in dev/test.
 */
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";

let cached: { client: S3Client; bucket: string } | null | undefined;

export function getWorkerR2(): { client: S3Client; bucket: string } | null {
  if (cached !== undefined) return cached;
  const { R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_ENDPOINT } = process.env;
  if (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET || !R2_ENDPOINT) {
    cached = null;
    return null;
  }
  cached = {
    client: new S3Client({
      region: "auto",
      endpoint: R2_ENDPOINT,
      credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
    }),
    bucket: R2_BUCKET,
  };
  return cached;
}

export function workerR2Configured(): boolean {
  return getWorkerR2() !== null;
}

export async function deleteR2Object(key: string): Promise<void> {
  const r2 = getWorkerR2();
  if (!r2) throw new Error("R2 not configured");
  await r2.client.send(new DeleteObjectCommand({ Bucket: r2.bucket, Key: key }));
}
