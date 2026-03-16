import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";

let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (s3Client) return s3Client;

  const config: ConstructorParameters<typeof S3Client>[0] = {
    region: process.env.S3_REGION || "ap-southeast-2",
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
    },
  };

  if (process.env.S3_ENDPOINT) {
    config.endpoint = process.env.S3_ENDPOINT;
    config.forcePathStyle = true; // Required for MinIO / R2
  }

  s3Client = new S3Client(config);
  return s3Client;
}

function getBucket(): string {
  return process.env.S3_BUCKET || "gearflow-uploads";
}

export interface UploadResult {
  storageKey: string;
  url: string;
}

export async function ensureBucket(): Promise<void> {
  const client = getS3Client();
  const bucket = getBucket();
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  }
}

export async function uploadToS3(
  file: Buffer,
  options: {
    organizationId: string;
    folder: string;
    entityId: string;
    fileName: string;
    mimeType: string;
  }
): Promise<UploadResult> {
  const client = getS3Client();
  const bucket = getBucket();

  const safeName = options.fileName.replace(/[^a-zA-Z0-9._-]/g, "-");
  const uuid = randomUUID().split("-")[0];
  const storageKey = `${options.organizationId}/${options.folder}/${options.entityId}/${uuid}-${safeName}`;

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: storageKey,
      Body: file,
      ContentType: options.mimeType,
    })
  );

  return {
    storageKey,
    url: `/api/files/${storageKey}`,
  };
}

export async function deleteFromS3(storageKey: string): Promise<void> {
  const client = getS3Client();
  const bucket = getBucket();

  await client.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: storageKey,
    })
  );
}

export async function getFromS3(storageKey: string) {
  const client = getS3Client();
  const bucket = getBucket();

  const response = await client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: storageKey,
    })
  );

  return response;
}

export function getProxyUrl(storageKey: string): string {
  return `/api/files/${storageKey}`;
}

/** Extract storage key from a proxy URL like /api/files/{key} */
export function storageKeyFromUrl(proxyUrl: string): string | null {
  const prefix = "/api/files/";
  const idx = proxyUrl.indexOf(prefix);
  if (idx === -1) return null;
  return proxyUrl.slice(idx + prefix.length);
}

/** Read a file from S3 and return it as a base64 data URI */
export async function getFileAsDataUri(proxyUrl: string): Promise<string | null> {
  const key = storageKeyFromUrl(proxyUrl);
  if (!key) return null;

  // Try the key directly first
  const result = await fetchS3AsDataUri(key);
  if (result) return result;

  // If the URL was a thumbnail, try to find the original
  if (proxyUrl.includes("_thumb")) {
    // Strategy 1: strip _thumb suffix to reconstruct the original key
    const thumbKey = storageKeyFromUrl(proxyUrl);
    if (thumbKey) {
      const originalKey = thumbKey.replace(/_thumb(\.[^.]+)$/, "$1");
      if (originalKey !== thumbKey) {
        const originalResult = await fetchS3AsDataUri(originalKey);
        if (originalResult) return originalResult;
      }
    }

    // Strategy 2: look up the FileUpload record by thumbnailUrl
    try {
      const { prisma } = await import("@/lib/prisma");
      const record = await prisma.fileUpload.findFirst({
        where: { thumbnailUrl: proxyUrl },
        select: { storageKey: true },
      });
      if (record) {
        return fetchS3AsDataUri(record.storageKey);
      }
    } catch {
      // DB lookup failed, give up
    }
  }

  return null;
}

async function fetchS3AsDataUri(key: string): Promise<string | null> {
  try {
    const response = await getFromS3(key);
    if (!response.Body) return null;
    const bytes = await response.Body.transformToByteArray();
    const contentType = response.ContentType || "image/png";
    return `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`;
  } catch {
    return null;
  }
}
