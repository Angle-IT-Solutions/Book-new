import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const getSecret = () => {
  const secret = process.env.PAYLOAD_SECRET
  if (!secret) throw new Error('PAYLOAD_SECRET must be configured.')
  return secret
}

const signNonce = (nonce: string) =>
  createHmac('sha256', getSecret()).update(`media-capability:${nonce}`).digest('base64url')

export function createMediaCapability() {
  const nonce = randomBytes(32).toString('base64url')
  return `${nonce}.${signNonce(nonce)}`
}

export function verifyMediaCapability(token: string | null | undefined): token is string {
  if (!token) return false
  const [nonce, signature, extra] = token.split('.')
  if (
    extra !== undefined ||
    !/^[A-Za-z0-9_-]{43}$/.test(nonce || '') ||
    !/^[A-Za-z0-9_-]{43}$/.test(signature || '')
  ) {
    return false
  }

  const expected = Buffer.from(signNonce(nonce))
  const supplied = Buffer.from(signature)
  return timingSafeEqual(expected, supplied)
}

export function hashMediaCapability(token: string) {
  return createHmac('sha256', getSecret()).update(`media-owner:${token}`).digest('hex')
}