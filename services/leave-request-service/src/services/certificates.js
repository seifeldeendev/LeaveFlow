// Medical certificates are health data: private bucket, KMS encryption, short signed links, strict type and size.
import { S3Client, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { awsClientConfig, cfg } from '../lib/config.js';
import { HttpError } from '../lib/errors.js';

const s3 = new S3Client({ ...awsClientConfig(), forcePathStyle: Boolean(cfg.endpoint) });
// Signing happens offline, so links can be signed for the address the browser can reach.
const signer = cfg.s3PublicEndpoint
  ? new S3Client({ region: cfg.region, endpoint: cfg.s3PublicEndpoint, forcePathStyle: true })
  : s3;
const TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const MAX_BYTES = 5 * 1024 * 1024;
const LINK_SECONDS = 300;

// The key never contains user input, so it cannot be used for path tricks.
export const certificateKey = (r) => `certificates/${r.employee_id}/${r.id}`;

export async function uploadLink(r, contentType) {
  if (!TYPES.includes(contentType)) {
    throw new HttpError(415, 'UNSUPPORTED_FILE_TYPE', 'Certificate must be a PDF, JPG or PNG');
  }
  const kms = cfg.kmsKeyId
    ? { 'x-amz-server-side-encryption': 'aws:kms', 'x-amz-server-side-encryption-aws-kms-key-id': cfg.kmsKeyId }
    : {};
  // S3 itself enforces these conditions: wrong type, larger file or late upload is refused.
  const post = await createPresignedPost(signer, {
    Bucket: cfg.certBucket,
    Key: certificateKey(r),
    Expires: LINK_SECONDS,
    Fields: { 'Content-Type': contentType, ...kms },
    Conditions: [['content-length-range', 1, MAX_BYTES], ['eq', '$Content-Type', contentType]],
  });
  return { url: post.url, fields: post.fields, expiresInSeconds: LINK_SECONDS, maxBytes: MAX_BYTES };
}

export async function viewLink(r) {
  const Key = certificateKey(r);
  try {
    await s3.send(new HeadObjectCommand({ Bucket: cfg.certBucket, Key }));
  } catch {
    throw new HttpError(404, 'NOT_FOUND', 'The certificate has not been uploaded yet');
  }
  const url = await getSignedUrl(signer, new GetObjectCommand({ Bucket: cfg.certBucket, Key, ResponseContentDisposition: 'inline' }), { expiresIn: LINK_SECONDS });
  return { url, expiresInSeconds: LINK_SECONDS };
}

export async function removeCertificate(r) {
  await s3.send(new DeleteObjectCommand({ Bucket: cfg.certBucket, Key: certificateKey(r) }));
}
