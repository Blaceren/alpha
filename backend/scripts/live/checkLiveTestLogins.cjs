const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:3000';
const password = process.env.TEST_ACCOUNT_PASSWORD;

if (!password) {
  console.error('TEST_ACCOUNT_PASSWORD is required');
  process.exit(1);
}

const accounts = [
  {
    email: 'admin@test.com',
    role: 'admin',
    allow: ['/admin', '/admin/users'],
  },
  {
    email: 'user@test.com',
    role: 'user',
    allow: ['/dashboard'],
    nav: true,
  },
  {
    email: 'support@test.com',
    role: 'support',
    allow: ['/support', '/admin/feedback'],
  },
  {
    email: 'mentor@test.com',
    role: 'mentor',
    allow: ['/support', '/admin/task-reports'],
  },
  {
    email: 'moderator@test.com',
    role: 'moderator',
    allow: ['/admin/chat-moderation'],
  },
  {
    email: 'news@test.com',
    role: 'news_editor',
    allow: ['/admin/news'],
    deny: ['/admin/users'],
  },
];

function getSetCookies(headers) {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const raw = headers.get('set-cookie');
  return raw ? [raw] : [];
}

function mergeCookies(jar, headers) {
  for (const header of getSetCookies(headers)) {
    const firstPart = header.split(';')[0];
    const separator = firstPart.indexOf('=');
    if (separator > 0) jar.set(firstPart.slice(0, separator), firstPart.slice(separator + 1));
  }
}

function cookieHeader(jar) {
  return [...jar.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
}

async function request(path, options = {}, jar = new Map()) {
  const headers = new Headers(options.headers || {});
  const cookies = cookieHeader(jar);
  if (cookies) headers.set('cookie', cookies);
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers,
    redirect: 'manual',
  });
  mergeCookies(jar, response.headers);
  return response;
}

async function login(account) {
  const jar = new Map();
  const response = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: account.email,
      password,
      captchaToken: 'dev-captcha-ok',
    }),
  }, jar);
  const text = await response.text();
  const hasSession = jar.has('trading_platform_session');
  return {
    ok: response.ok && hasSession,
    status: response.status,
    hasSession,
    body: text ? JSON.parse(text) : null,
    jar,
  };
}

function assertAllowedStatus(status) {
  return status >= 200 && status < 300;
}

function assertDeniedStatus(status, location) {
  return [302, 303, 307, 308].includes(status) && location?.includes('/403');
}

function includesAny(text, values) {
  return values.some((value) => text.includes(value));
}

async function checkNav(jar) {
  const response = await request('/dashboard', { method: 'GET' }, jar);
  const html = await response.text();
  return {
    status: response.status,
    notificationBell: html.includes('Уведомления:') || html.includes('🔔'),
    community: includesAny(html, ['Сообщество', 'Community']),
    news: includesAny(html, ['Новости', 'News']),
    profile: includesAny(html, ['Профиль', 'Profile']),
    reportProblem: includesAny(html, ['Сообщить о проблеме', 'Report problem']),
    noExchangeSeparateTab: !includesAny(html, ['Биржа', '>Exchange<']),
    noNotificationsSeparateTab: !includesAny(html, ['>Notifications<', '>Уведомления<']),
    noFeedbackSeparateTab: !includesAny(html, ['>Feedback<', '>Фидбек<']),
  };
}

(async () => {
  const results = [];
  let failed = false;

  for (const account of accounts) {
    const loginResult = await login(account);
    const accountResult = {
      email: account.email,
      role: account.role,
      loginStatus: loginResult.status,
      sessionCreated: loginResult.hasSession,
      routes: [],
    };

    if (!loginResult.ok) {
      failed = true;
      accountResult.loginError = loginResult.body?.error || loginResult.body?.message || 'login_failed';
      results.push(accountResult);
      continue;
    }

    for (const path of account.allow || []) {
      const response = await request(path, { method: 'GET' }, loginResult.jar);
      const ok = assertAllowedStatus(response.status);
      if (!ok) failed = true;
      accountResult.routes.push({ path, status: response.status, ok });
    }

    for (const path of account.deny || []) {
      const response = await request(path, { method: 'GET' }, loginResult.jar);
      const location = response.headers.get('location');
      const ok = assertDeniedStatus(response.status, location);
      if (!ok) failed = true;
      accountResult.routes.push({ path, status: response.status, location, denied: ok });
    }

    if (account.nav) {
      accountResult.nav = await checkNav(loginResult.jar);
      if (!accountResult.nav.notificationBell || !accountResult.nav.community || !accountResult.nav.news || !accountResult.nav.profile || !accountResult.nav.reportProblem) {
        failed = true;
      }
      if (!accountResult.nav.noExchangeSeparateTab || !accountResult.nav.noNotificationsSeparateTab || !accountResult.nav.noFeedbackSeparateTab) {
        accountResult.navWarning = 'nav_shape_mismatch';
      }
    }

    results.push(accountResult);
  }

  for (const result of results) {
    console.log(JSON.stringify(result));
  }

  if (failed) process.exit(1);
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
