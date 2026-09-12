/**
 * The CAPTCHA purposes this platform recognises.
 *
 * Split out of `src/lib/captcha.ts` in AFD-3A3 so the surface registry can name
 * a purpose without importing the verifier that imports the registry.
 *
 * `checkpoint` is declared but has no surface and no caller: it is part of the
 * original purpose vocabulary and is kept so the union does not silently narrow.
 * Should a checkpoint challenge ever ship it must register a surface here first
 * — a purpose with no surface cannot pass an enforced verification, which is the
 * intended direction of failure.
 */
export type CaptchaPurpose = "login" | "register" | "checkpoint";
