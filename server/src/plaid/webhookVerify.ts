import { createHash, createPublicKey, timingSafeEqual, KeyObject } from 'crypto';
import jwt from 'jsonwebtoken';
import { plaidClient } from './client';

// Cache verification keys by key id (kid)
const keyCache = new Map<string, { key: KeyObject; expiredAt: number | null }>();

function safeEqualHex(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

/**
 * Verifies a Plaid webhook per https://plaid.com/docs/api/webhooks/webhook-verification/
 * - JWT in the `plaid-verification` header, signed ES256
 * - Public key fetched from Plaid via /webhook_verification_key/get
 * - SHA-256 of the raw request body must match the `request_body_sha256` claim
 */
export async function verifyPlaidWebhook(signedJwt: string | undefined, rawBody: string | undefined): Promise<boolean> {
  if (!signedJwt || !rawBody) return false;

  const decoded = jwt.decode(signedJwt, { complete: true });
  if (!decoded || typeof decoded === 'string') return false;
  const { kid, alg } = decoded.header;
  if (alg !== 'ES256' || !kid) return false;

  let cached = keyCache.get(kid);
  if (!cached) {
    const res = await plaidClient.webhookVerificationKeyGet({ key_id: kid });
    const jwk = res.data.key;
    cached = {
      // createPublicKey supports JWK input on Node 17+
      key: createPublicKey({ key: jwk as unknown as Record<string, unknown>, format: 'jwk' } as never),
      expiredAt: jwk.expired_at ?? null,
    };
    keyCache.set(kid, cached);
  }
  if (cached.expiredAt != null) return false;

  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(signedJwt, cached.key, { algorithms: ['ES256'], maxAge: '5 minutes' }) as jwt.JwtPayload;
  } catch {
    return false;
  }

  const bodyHash = createHash('sha256').update(rawBody, 'utf8').digest('hex');
  return safeEqualHex(bodyHash, String(payload.request_body_sha256 ?? ''));
}
