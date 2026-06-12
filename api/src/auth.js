import { createHmac, timingSafeEqual } from 'node:crypto';

const sessionCookieName = 'gdns_session';
const sessionTtlMs = Number(process.env.SESSION_TTL_MS || 30 * 24 * 60 * 60 * 1000);

function base64Url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(value, secret) {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function getCookie(request, name) {
  const cookie = request.headers.cookie || '';
  const parts = cookie.split(';').map((part) => part.trim());
  const prefix = `${name}=`;
  const found = parts.find((part) => part.startsWith(prefix));

  return found ? decodeURIComponent(found.slice(prefix.length)) : null;
}

function createSessionValue(secret) {
  const payload = base64Url(JSON.stringify({
    exp: Date.now() + sessionTtlMs,
    v: 1,
  }));

  return `${payload}.${sign(payload, secret)}`;
}

function isValidSessionValue(value, secret) {
  if (!value || !value.includes('.')) {
    return false;
  }

  const [payload, signature] = value.split('.', 2);
  if (!payload || !signature || !safeEqual(signature, sign(payload, secret))) {
    return false;
  }

  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Number(session.exp) > Date.now();
  } catch {
    return false;
  }
}

function cookieOptions(maxAgeSeconds) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

export function createSessionCookie() {
  const secret = process.env.API_SECRET;
  if (!secret) {
    return `${sessionCookieName}=dev; ${cookieOptions(Math.floor(sessionTtlMs / 1000))}`;
  }

  return `${sessionCookieName}=${encodeURIComponent(createSessionValue(secret))}; ${cookieOptions(Math.floor(sessionTtlMs / 1000))}`;
}

export function clearSessionCookie() {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${sessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export function isValidApiToken(token) {
  const secret = process.env.API_SECRET;
  return !secret || token === secret;
}

export function isAuthorized(request) {
  const secret = process.env.API_SECRET;
  if (!secret) {
    return true;
  }

  const auth = request.headers.authorization || '';
  if (auth === `Bearer ${secret}`) {
    return true;
  }

  return isValidSessionValue(getCookie(request, sessionCookieName), secret);
}
