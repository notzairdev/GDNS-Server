import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const legacySessionCookieName = 'gdns_session';
const secureSessionCookieName = '__Host-gdns_session';
const sessionTtlMs = Number(process.env.SESSION_TTL_MS || 12 * 60 * 60 * 1000);
const loginWindowMs = Number(process.env.LOGIN_WINDOW_MS || 15 * 60 * 1000);
const loginLockMs = Number(process.env.LOGIN_LOCK_MS || 15 * 60 * 1000);
const loginMaxFailures = Number(process.env.LOGIN_MAX_FAILURES || 5);
const loginAttempts = new Map();

function base64Url(input) {
  return Buffer.from(input).toString('base64url');
}

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

function activeSessionCookieName() {
  return isProduction() ? secureSessionCookieName : legacySessionCookieName;
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

function requestIp(request) {
  const forwarded = String(request.headers['x-forwarded-for'] || '')
    .split(',')[0]
    .trim();

  return forwarded || request.ip || request.socket?.remoteAddress || 'unknown';
}

function requestFingerprint(request) {
  const userAgent = String(request.headers['user-agent'] || 'unknown');
  return createHash('sha256').update(userAgent).digest('base64url');
}

function loginKey(request) {
  return createHash('sha256')
    .update(`${requestIp(request)}:${String(request.headers['user-agent'] || 'unknown')}`)
    .digest('base64url');
}

function loginAttemptState(request) {
  const key = loginKey(request);
  const now = Date.now();
  const state = loginAttempts.get(key);

  if (!state || state.expiresAt <= now) {
    const fresh = {
      count: 0,
      expiresAt: now + loginWindowMs,
      lockedUntil: 0,
    };
    loginAttempts.set(key, fresh);
    return { key, state: fresh };
  }

  return { key, state };
}

export function isLoginLocked(request) {
  return loginAttemptState(request).state.lockedUntil > Date.now();
}

export function recordLoginFailure(request) {
  const { key, state } = loginAttemptState(request);
  state.count += 1;
  state.expiresAt = Date.now() + loginWindowMs;

  if (state.count >= loginMaxFailures) {
    state.lockedUntil = Date.now() + loginLockMs;
  }

  loginAttempts.set(key, state);
}

export function clearLoginFailures(request) {
  loginAttempts.delete(loginKey(request));
}

function createSessionValue(secret, request) {
  const now = Date.now();
  const payload = base64Url(JSON.stringify({
    exp: now + sessionTtlMs,
    iat: now,
    fp: requestFingerprint(request),
    v: 1,
  }));

  return `${payload}.${sign(payload, secret)}`;
}

function isValidSessionValue(value, secret, request) {
  if (!value || !value.includes('.')) {
    return false;
  }

  const [payload, signature] = value.split('.', 2);
  if (!payload || !signature || !safeEqual(signature, sign(payload, secret))) {
    return false;
  }

  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return (
      Number(session.exp) > Date.now()
      && session.fp === requestFingerprint(request)
    );
  } catch {
    return false;
  }
}

function cookieOptions(maxAgeSeconds) {
  const secure = isProduction() ? '; Secure' : '';
  return `Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}; Priority=High${secure}`;
}

export function createSessionCookie(request) {
  const secret = process.env.API_SECRET;
  if (!secret) {
    return `${activeSessionCookieName()}=dev; ${cookieOptions(Math.floor(sessionTtlMs / 1000))}`;
  }

  return `${activeSessionCookieName()}=${encodeURIComponent(createSessionValue(secret, request))}; ${cookieOptions(Math.floor(sessionTtlMs / 1000))}`;
}

export function clearSessionCookie() {
  const secure = isProduction() ? '; Secure' : '';
  return [
    `${activeSessionCookieName()}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`,
    `${legacySessionCookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`,
  ];
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

  return (
    isValidSessionValue(getCookie(request, activeSessionCookieName()), secret, request)
    || isValidSessionValue(getCookie(request, legacySessionCookieName), secret, request)
  );
}
