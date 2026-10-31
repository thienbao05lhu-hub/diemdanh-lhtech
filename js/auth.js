(function (root) {
  'use strict';
  const config = root.ATTENDANCE_CONFIG;
  if (!config || !root.supabase?.createClient) return;
  const client = root.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: { storage: root.sessionStorage, storageKey: 'lhtech-attendance-auth-v1', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    global: {
      fetch: (url, options = {}) => root.fetch(url, {
        ...options,
        signal: options.signal
          ? AbortSignal.any([options.signal, AbortSignal.timeout(20000)])
          : AbortSignal.timeout(20000),
      }),
    },
  });
  const adminRoles = ['admin', 'super_admin'];
  const roleLabels = { student: 'Sinh viên', admin: 'Quản trị viên', super_admin: 'Quản trị cao nhất' };

  function message(error) {
    const code = error?.code;
    if (code === 'PROFILE_MISSING') return 'Tài khoản chưa được cấp hồ sơ hoặc đã bị khóa. Vui lòng liên hệ quản trị viên.';
    if (code === 'invalid_credentials') return 'Email hoặc mật khẩu chưa đúng.';
    if (code === 'email_not_confirmed') return 'Email tài khoản chưa được xác nhận. Vui lòng liên hệ quản trị viên.';
    if (code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit' || error?.status === 429) return 'Bạn thao tác quá nhanh. Vui lòng chờ một lát rồi thử lại.';
    if (code === '42501') return 'Tài khoản không có quyền thực hiện thao tác này.';
    if (code === 'PGRST202' || code === 'PGRST205' || code === '42P01') return 'Dữ liệu hệ thống chưa sẵn sàng. Vui lòng liên hệ quản trị viên.';
    if (code === 'NETWORK_ERROR' || error?.name === 'AbortError' || error?.name === 'TimeoutError' || error?.status === 0 || error?.name === 'AuthRetryableFetchError' || error instanceof TypeError) return 'Không kết nối được hệ thống. Kiểm tra mạng rồi thử lại.';
    return 'Không hoàn tất được thao tác. Vui lòng thử lại.';
  }
  function setStatus(element, text = '', error = false) {
    if (!element) return;
    element.textContent = text;
    element.classList.toggle('error', error);
  }
  function safeNext(value) {
    if (!value || !/^(admin|app|checkin)\.html(?:\?[^#]*)?$/.test(value)) return null;
    const url = new URL(value, root.location.href);
    if (url.pathname.endsWith('/checkin.html')) {
      const token = url.searchParams.get('t');
      return token ? `checkin.html?t=${encodeURIComponent(token.slice(0, 2048))}` : 'checkin.html';
    }
    return value.split('?')[0];
  }
  function destination(profile) {
    const next = safeNext(new URLSearchParams(root.location.search).get('next'));
    if (next && (next !== 'admin.html' || adminRoles.includes(profile.role))) return next;
    return adminRoles.includes(profile.role) ? 'admin.html' : 'app.html';
  }
  function loginUrl() {
    const file = root.location.pathname.split('/').pop();
    const next = safeNext(`${file}${root.location.search}`);
    return next ? `index.html?next=${encodeURIComponent(next)}` : 'index.html';
  }
  function checkResult(result) {
    if (result.error) {
      if (result.status === 0) throw Object.assign(new Error('Network unavailable'), { code: 'NETWORK_ERROR' });
      throw result.error;
    }
    return result;
  }
  async function identity() {
    const session = await client.auth.getSession();
    if (session.error) throw session.error;
    if (!session.data.session) return null;
    const verified = await client.auth.getUser();
    if (verified.error) {
      if (verified.error.status === 401 || verified.error.status === 403 || verified.error.name === 'AuthSessionMissingError') {
        await client.auth.signOut({ scope: 'local' });
        return null;
      }
      throw verified.error;
    }
    const result = checkResult(await client.rpc('get_my_profile'));
    if (!result.data || result.data.id !== verified.data.user?.id || !roleLabels[result.data.role]) {
      const error = new Error('Profile unavailable');
      error.code = 'PROFILE_MISSING';
      throw error;
    }
    return { user: verified.data.user, profile: result.data };
  }
  async function requireIdentity(roles) {
    const current = await identity();
    if (!current) { root.location.replace(loginUrl()); return null; }
    if (roles && !roles.includes(current.profile.role)) { root.location.replace('app.html'); return null; }
    return current;
  }
  function bindLogout(statusElement) {
    const button = document.getElementById('logout');
    button?.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const result = await client.auth.signOut({ scope: 'local' });
        if (result.error) throw result.error;
        root.location.replace('index.html');
      } catch (error) { setStatus(statusElement, message(error), true); button.disabled = false; }
    });
    client.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        document.getElementById('protected-content')?.setAttribute('hidden', '');
        root.location.replace('index.html');
      }
    });
  }
  root.Attendance = Object.freeze({ client, identity, requireIdentity, bindLogout, destination, safeNext, checkResult, setStatus, message, adminRoles, roleLabels });
})(globalThis);
