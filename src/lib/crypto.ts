import crypto from 'node:crypto'

/**
 * A licence key is presented on every lease, so it is stored the way a password
 * is: hashed, never recoverable. It is shown to the operator once, at issue.
 */
export function hashKey(key: string): string {
  return crypto.createHash('sha256').update(key.trim()).digest('hex')
}

/** LIC-XXXX-XXXX-XXXX-XXXX, from an alphabet with no look-alike characters. */
export function generateKey(): string {
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const group = () => Array.from(crypto.randomFillSync(new Uint8Array(4)))
    .map(b => ALPHABET[b % ALPHABET.length]).join('')
  return `LIC-${group()}-${group()}-${group()}-${group()}`
}

function secretKey(): Buffer {
  const raw = process.env.SECRET_ENCRYPTION_KEY
  if (!raw) throw new Error('SECRET_ENCRYPTION_KEY is not set')
  const buf = Buffer.from(raw, 'base64')
  if (buf.length !== 32) throw new Error('SECRET_ENCRYPTION_KEY must be 32 bytes, base64-encoded')
  return buf
}

/** iv.tag.ciphertext, each base64url — one column, no separate iv to mislay. */
export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', secretKey(), iv)
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), data].map(b => b.toString('base64url')).join('.')
}

export function decryptSecret(packed: string): string {
  const [iv, tag, data] = packed.split('.').map(p => Buffer.from(p, 'base64url'))
  const decipher = crypto.createDecipheriv('aes-256-gcm', secretKey(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}

/**
 * Sign a lease so an installation can tell this service's answer from a
 * stand-in. The public half is compiled into the installation; the private half
 * never leaves here.
 *
 * This matters mostly for the "still licensed" case: without a signature,
 * anyone could point an installation at a server of their own that always says
 * yes. They would still get no credentials from it — the signature is the
 * cheaper of the two defences, not the load-bearing one.
 */
export function signLease(payload: string): string {
  const pem = process.env.LEASE_SIGNING_KEY
  if (!pem) throw new Error('LEASE_SIGNING_KEY is not set')
  const key = crypto.createPrivateKey(Buffer.from(pem, 'base64').toString('utf8'))
  return crypto.sign(null, Buffer.from(payload, 'utf8'), key).toString('base64url')
}

/** Ed25519 pair: private goes in this service's env, public into the installs. */
export function generateSigningPair(): { privateKeyB64: string; publicKeyB64: string } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
  return {
    privateKeyB64: Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' }) as string).toString('base64'),
    publicKeyB64: Buffer.from(publicKey.export({ type: 'spki', format: 'pem' }) as string).toString('base64'),
  }
}
