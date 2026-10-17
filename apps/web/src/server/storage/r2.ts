import "server-only";
import { DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../env";

/**
 * Cloudflare R2 (S3-compatible) for every file: voice audio, images, renders, covers, captions (PRD D12).
 * Keys are namespaced per user and project: users/<userId>/projects/<projectId>/<kind>/<file>.
 */
let client: S3Client | null = null;

function r2(): S3Client {
  client ??= new S3Client({
    region: "auto",
    endpoint: `https://${env.r2.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env.r2.accessKeyId, secretAccessKey: env.r2.secretAccessKey },
  });
  return client;
}

/** Everything a user has stored (account deletion). */
export const userPrefix = (userId: string) => `users/${userId}/`;
export const projectPrefix = (userId: string, projectId: string) => `${userPrefix(userId)}projects/${projectId}/`;

/** Short-lived download link (generated on click, so links in the UI never go stale). */
export function signedGetUrl(key: string, expiresInSec = 600, downloadName?: string): Promise<string> {
  return getSignedUrl(
    r2(),
    new GetObjectCommand({
      Bucket: env.r2.bucket,
      Key: key,
      ResponseContentDisposition: downloadName ? `attachment; filename="${downloadName.replace(/"/g, "")}"` : undefined,
    }),
    { expiresIn: expiresInSec },
  );
}

/** Upload link for the render agent / browser to put a file directly into R2. */
export function signedPutUrl(key: string, contentType: string, expiresInSec = 900): Promise<string> {
  return getSignedUrl(r2(), new PutObjectCommand({ Bucket: env.r2.bucket, Key: key, ContentType: contentType }), { expiresIn: expiresInSec });
}

/** Removes every file under a prefix (project purge / account deletion). */
export async function deletePrefix(prefix: string): Promise<number> {
  let deleted = 0;
  let token: string | undefined;
  do {
    const page = await r2().send(new ListObjectsV2Command({ Bucket: env.r2.bucket, Prefix: prefix, ContinuationToken: token }));
    const keys = (page.Contents ?? []).map((o) => ({ Key: o.Key! }));
    if (keys.length) {
      await r2().send(new DeleteObjectsCommand({ Bucket: env.r2.bucket, Delete: { Objects: keys } }));
      deleted += keys.length;
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return deleted;
}
