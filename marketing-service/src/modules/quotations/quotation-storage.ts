import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../../config/env.js';
import { HttpError } from '../../utils/httpError.js';

let client: S3Client | undefined;
function storageClient() {
  if (!env.AWS_ENDPOINT_URL_S3 || !env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
    throw new HttpError('Quotation storage is not configured', 503);
  }
  return client ??= new S3Client({
    endpoint: env.AWS_ENDPOINT_URL_S3, region: env.AWS_REGION, forcePathStyle: true,
    credentials: { accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY },
    requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED', maxAttempts: 2,
  });
}

export const quotationStorage = {
  bucket: () => env.AWS_S3_BUCKET,
  async upload(bucket: string, key: string, body: Buffer, fileName: string) {
    await storageClient().send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body,
      ContentType: 'application/pdf', ContentDisposition: `attachment; filename="${fileName}"`,
    }), { abortSignal: AbortSignal.timeout(30000) });
  },
  async remove(bucket: string, key: string) {
    await storageClient().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: AbortSignal.timeout(10000) });
  },
  async downloadUrl(bucket: string, key: string) {
    const expiresIn = 900;
    const url = await getSignedUrl(storageClient(), new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn });
    return { url, expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() };
  },
};
