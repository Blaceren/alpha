"use client";

import { useEffect, useState } from "react";

const COOKIE_CONSENT_STORAGE_KEY = "trading-platform-cookie-consent";

type CookieConsent = {
  necessary: true;
  analytics: boolean;
  marketing: boolean;
  functional: boolean;
};

const defaultConsent: CookieConsent = {
  necessary: true,
  analytics: false,
  marketing: false,
  functional: false,
};

export function CookieBanner() {
  const [isVisible, setIsVisible] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [consent, setConsent] = useState<CookieConsent>(defaultConsent);

  useEffect(() => {
    const savedConsent = window.localStorage.getItem(
      COOKIE_CONSENT_STORAGE_KEY,
    );

    if (!savedConsent) {
      setIsVisible(true);
    }
  }, []);

  function saveConsent(nextConsent: CookieConsent) {
    window.localStorage.setItem(
      COOKIE_CONSENT_STORAGE_KEY,
      JSON.stringify(nextConsent),
    );
    setConsent(nextConsent);
    setIsVisible(false);
  }

  if (!isVisible) {
    return null;
  }

  return (
    <section className="fixed bottom-4 left-4 right-4 z-50 sm:right-auto sm:max-w-xl">
      <div className="space-y-4 rounded-lg border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_96%,transparent)] p-4 shadow-[var(--shadow-strong)] backdrop-blur-xl">
        <div>
          <h2 className="font-semibold text-[var(--text-primary)]">Cookies</h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Мы используем cookies для работы платформы и будущих модулей аналитики.
            Сейчас согласие сохраняется только локально в браузере.
          </p>
        </div>

        {isSettingsOpen ? (
          <div className="grid gap-3 text-sm text-[var(--text-secondary)] sm:grid-cols-2">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked disabled />
              Необходимые cookies
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={consent.analytics}
                onChange={(event) =>
                  setConsent((current) => ({
                    ...current,
                    analytics: event.target.checked,
                  }))
                }
              />
              Аналитика
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={consent.marketing}
                onChange={(event) =>
                  setConsent((current) => ({
                    ...current,
                    marketing: event.target.checked,
                  }))
                }
              />
              Маркетинг
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={consent.functional}
                onChange={(event) =>
                  setConsent((current) => ({
                    ...current,
                    functional: event.target.checked,
                  }))
                }
              />
              Функциональные
            </label>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() =>
              saveConsent({
                necessary: true,
                analytics: true,
                marketing: true,
                functional: true,
              })
            }
            className="btn btn-primary"
          >
            Принять все
          </button>
          <button
            type="button"
            onClick={() => saveConsent(defaultConsent)}
            className="btn btn-secondary"
          >
            Отклонить необязательные
          </button>
          <button
            type="button"
            onClick={() => {
              if (isSettingsOpen) {
                saveConsent(consent);
                return;
              }

              setIsSettingsOpen(true);
            }}
            className="btn btn-secondary"
          >
            {isSettingsOpen ? "Сохранить настройки" : "Настроить"}
          </button>
        </div>
      </div>
    </section>
  );
}
