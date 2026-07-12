export type CaptchaPurpose = "login" | "register" | "checkpoint";

export type CaptchaVerificationInput = {
  token?: string | null;
  purpose: CaptchaPurpose;
  request?: Request;
};

export type CaptchaVerificationResult = {
  ok: boolean;
  provider: "dev";
  message?: string;
};

export async function verifyCaptcha(input: CaptchaVerificationInput): Promise<CaptchaVerificationResult> {
  const bypassEnabled = process.env.CAPTCHA_DEV_BYPASS !== "false";

  if (bypassEnabled && (!input.token || input.token === "dev-captcha-ok")) {
    return { ok: true, provider: "dev" };
  }

  return {
    ok: false,
    provider: "dev",
    message: "Captcha provider не настроен. Для closed beta включите CAPTCHA_DEV_BYPASS=true.",
  };
}
