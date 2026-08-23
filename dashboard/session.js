// Sesión propia con cookie firmada (HMAC-SHA256) en vez de express-session/jsonwebtoken
// — no hace falta un store de sesiones (todo el estado es "quién sos", nada más) ni un
// formato de token con más features de las que se usan acá.
import crypto from 'node:crypto';
import { dashboardConfig } from './config.js';

const COOKIE_NAME = 'nexo_dashboard_session';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 días

const isHttps = dashboardConfig.baseUrl.startsWith('https://');

export function parseCookies(header) {
  const result = {};
  if (!header) return result;
  for (const part of header.split(';')) {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex === -1) continue;
    const key = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();
    if (key) result[key] = decodeURIComponent(value);
  }
  return result;
}

function sign(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', dashboardConfig.sessionSecret).update(data).digest('base64url');
  return `${data}.${signature}`;
}

function verify(token) {
  const [data, signature] = token.split('.');
  if (!data || !signature) return null;

  const expected = crypto.createHmac('sha256', dashboardConfig.sessionSecret).update(data).digest('base64url');
  const signatureBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (signatureBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(signatureBuf, expectedBuf)) return null;

  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (typeof payload.exp !== 'number' || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function cookieFlags(maxAgeSeconds) {
  return `HttpOnly; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax${isHttps ? '; Secure' : ''}`;
}

export function createSessionCookie(userId) {
  const token = sign({ userId, exp: Date.now() + MAX_AGE_MS });
  return `${COOKIE_NAME}=${token}; ${cookieFlags(Math.floor(MAX_AGE_MS / 1000))}`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; ${cookieFlags(0)}`;
}

export function readSession(req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  return verify(token);
}

export function createStateCookie(state) {
  return `oauth_state=${state}; ${cookieFlags(300)}`;
}

export function clearStateCookie() {
  return `oauth_state=; ${cookieFlags(0)}`;
}
