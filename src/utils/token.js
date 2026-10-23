import jwt from 'jsonwebtoken';

const FALLBACK_DEV_SECRET = 'ledgerflow_fallback_secret_key_change_in_production_32chars';

/**
 * Validates and retrieves the JWT secret according to environment safety requirements.
 * In production mode, halts application startup if JWT_SECRET is unset or insecure.
 */
export function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction) {
    if (!secret || secret.trim() === '' || secret === FALLBACK_DEV_SECRET) {
      console.error('FATAL: JWT_SECRET environment variable is missing or insecure in production mode.');
      console.error('Configure a strong, unique JWT_SECRET before starting in production.');
      process.exit(1);
    }
    return secret;
  }

  // Development / Test mode safety notice
  if (!secret || secret === FALLBACK_DEV_SECRET) {
    if (!global.__jwtDevWarningLogged) {
      console.warn('⚠️  SECURITY NOTICE: Running with default development JWT secret.');
      console.warn('⚠️  Ensure a strong, unique JWT_SECRET is configured before deploying to production.');
      global.__jwtDevWarningLogged = true;
    }
    return FALLBACK_DEV_SECRET;
  }

  return secret;
}

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

/**
 * Generate a signed JSON Web Token
 */
export function generateToken(payload) {
  const secret = getJwtSecret();
  return jwt.sign(payload, secret, { expiresIn: JWT_EXPIRES_IN });
}

/**
 * Verify and decode a JWT
 */
export function verifyToken(token) {
  try {
    const secret = getJwtSecret();
    return jwt.verify(token, secret);
  } catch (error) {
    return null;
  }
}

/**
 * Standard HTTP-Only Cookie options
 */
export const authCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
  path: '/',
};
