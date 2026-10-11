import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "bella_session";
/** Con "Recordarme" la sesión dura 30 días aunque se cierre el navegador. */
export const REMEMBER_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
/** Sin "Recordarme" la cookie se borra al cerrar el navegador y el token vence en un día. */
export const SHORT_MAX_AGE_SECONDS = 60 * 60 * 24;

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 16) {
    throw new Error("SESSION_SECRET no está configurado (mínimo 16 caracteres).");
  }
  return new TextEncoder().encode(value);
}

export async function signSession(userId: string, maxAgeSeconds = SHORT_MAX_AGE_SECONDS) {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${maxAgeSeconds}s`)
    .sign(secret());
}

/** Usuario y momento de emisión (segundos) de un token válido. */
export async function readSession(token: string | undefined): Promise<{ userId: string; issuedAt: number } | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return payload.sub ? { userId: payload.sub, issuedAt: payload.iat ?? 0 } : null;
  } catch {
    return null;
  }
}

export async function verifySession(token: string | undefined): Promise<string | null> {
  return (await readSession(token))?.userId ?? null;
}

/** Opciones de la cookie: con `remember` persiste; sin él es de sesión del navegador. */
export function sessionCookieOptions(remember: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    ...(remember ? { maxAge: REMEMBER_MAX_AGE_SECONDS } : {}),
  };
}

/** Una sesión emitida antes del último cambio de contraseña ya no vale. */
export function sessionStale(issuedAt: number, passwordChangedAt: Date | null) {
  return passwordChangedAt != null && issuedAt < Math.floor(passwordChangedAt.getTime() / 1000);
}
