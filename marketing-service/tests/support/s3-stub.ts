/**
 * A minimal S3-compatible object store for the local test stack.
 *
 * The quotation approval path uploads the generated PDF to S3 and stores the
 * object key in the database. There is no S3 server in the local test
 * environment, so this stub implements exactly the operations the AWS SDK
 * client performs: PUT (upload), GET (download), HEAD (metadata) and DELETE
 * (removal), using path-style addressing.
 *
 * It listens on 127.0.0.1 only and holds objects in memory.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export interface S3Stub {
  endpoint: string;
  bucket: string;
  objects: Map<string, Buffer>;
  putCount: number;
  deleteCount: number;
  getCount: number;
  stop: () => Promise<void>;
}

const readBody = async (request: IncomingMessage): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
};

export const startS3Stub = async (port = 5199): Promise<S3Stub> => {
  const objects = new Map<string, Buffer>();
  const stub: S3Stub = {
    endpoint: `http://127.0.0.1:${port}`,
    bucket: 'akura-reltest',
    objects,
    putCount: 0,
    deleteCount: 0,
    getCount: 0,
    stop: async () => { await new Promise<void>((resolve) => server.close(() => resolve())); },
  };

  const server: Server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? '/', stub.endpoint);
    // Path-style addressing: /<bucket>/<key...>
    const path = url.pathname.replace(/^\//, '');
    const separator = path.indexOf('/');
    const bucket = separator === -1 ? path : path.slice(0, separator);
    const key = separator === -1 ? '' : path.slice(separator + 1);

    if (bucket !== stub.bucket) {
      response.writeHead(404).end();
      return;
    }

    if (request.method === 'PUT') {
      const body = await readBody(request);
      objects.set(key, body);
      stub.putCount += 1;
      response.writeHead(200, { etag: `"${key.length}"` }).end();
      return;
    }
    if (request.method === 'GET' || request.method === 'HEAD') {
      const object = objects.get(key);
      if (!object) {
        response.writeHead(404).end();
        return;
      }
      stub.getCount += 1;
      response.writeHead(200, {
        'content-type': 'application/pdf',
        'content-length': String(object.length),
      });
      response.end(request.method === 'HEAD' ? undefined : object);
      return;
    }
    if (request.method === 'DELETE') {
      objects.delete(key);
      stub.deleteCount += 1;
      response.writeHead(204).end();
      return;
    }
    response.writeHead(405).end();
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });

  return stub;
};

/** The S3 environment the marketing service needs to accept the stub. */
export const s3Environment = (stub: S3Stub): NodeJS.ProcessEnv => ({
  AWS_ENDPOINT_URL_S3: stub.endpoint,
  AWS_ACCESS_KEY_ID: 'reltest-local-access-key',
  AWS_SECRET_ACCESS_KEY: 'reltest-local-secret-key',
  AWS_REGION: 'us-east-2',
  AWS_S3_BUCKET: stub.bucket,
});
