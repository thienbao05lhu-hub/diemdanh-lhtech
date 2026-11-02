(function (root) {
  'use strict';
  if (root.AttendanceRedirecting) return;
  const config = root.ATTENDANCE_CONFIG;
  if (!config || !root.supabase?.createClient) return;
  // Đồng bộ session giữa sessionStorage (cũ) và localStorage (chuẩn)
  try {
    const legacy = root.sessionStorage?.getItem('lhtech-attendance-auth-v1');
    if (legacy && !root.localStorage?.getItem('lhtech-supabase-auth')) {
      root.localStorage?.setItem('lhtech-supabase-auth', legacy);
    }
  } catch(e) {}

  const client = root.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: {
      storage: root.localStorage, storageKey: 'lhtech-supabase-auth',
      persistSession: true, autoRefreshToken: true, flowType: 'implicit',
      detectSessionInUrl: root.location.pathname.endsWith('/reset-password.html'),
    },
    global: {
      fetch: (url, options = {}) => root.fetch(url, {
        ...options,
        signal: options.signal
          ? AbortSignal.any([options.signal, AbortSignal.timeout(20000)])
          : AbortSignal.timeout(20000),
      }),
    },
  });
  root.AttendanceTrialRouter?.install(client);
  const adminRoles = ['admin', 'super_admin'];
  const roleLabels = { student: 'Sinh viên', admin: 'Quản trị viên', super_admin: 'Quản trị cao nhất' };

  function message(error) {
    const code = error?.code;
    const appMessages = {
      APP_FORBIDDEN: 'Tài khoản không có quyền thực hiện thao tác này.',
      APP_PASSWORD_UPDATE_UNCONFIRMED: 'Chưa xác nhận được mật khẩu đã lưu. Thử đăng nhập bằng mật khẩu mới trước khi đổi lại.',
      APP_TEST_QR_ONLY: 'Chế độ hiện tại chỉ thử QR; gửi/duyệt nghỉ và sửa điểm danh thật đang tạm dừng.',
      APP_INVALID_INPUT: 'Thông tin chưa hợp lệ. Kiểm tra lại các trường bắt buộc.',
      APP_AUTH_NOT_FOUND: 'Chưa tìm thấy tài khoản đăng nhập duy nhất cho email này. Hãy cấp tài khoản trước.',
      APP_PROFILE_EXISTS: 'Email này đã gắn với một mã sinh viên khác.',
      APP_PROFILE_NOT_FOUND: 'Hồ sơ không tồn tại hoặc đang bị khóa.',
      APP_PROFILE_STALE: 'Hồ sơ đã được thay đổi. Hãy tải lại danh sách rồi chỉnh sửa lại.',
      APP_SELF_CHANGE: 'Bạn không thể tự hạ quyền hoặc khóa tài khoản đang sử dụng.',
      APP_LAST_ADMIN: 'Cần giữ ít nhất một tài khoản Quản trị cao nhất đang hoạt động.',
      APP_INVALID_SCHEDULE: 'Lịch chưa hợp lệ. Mỗi ngày chỉ gồm các ca Sáng, Chiều và Tối.',
      APP_SCHEDULE_STALE: 'Lịch đã được cập nhật ở nơi khác. Bỏ thay đổi và tải lại lịch mới trước khi lưu.',
      APP_REVISION_NOT_FOUND: 'Phiên bản này không còn trong lịch sử. Hãy tải lại danh sách lịch sử.',
      APP_DEVICE_MISMATCH: 'Thiết bị không khớp. Tài khoản của bạn đã được gắn với thiết bị khác để chống điểm danh hộ.',
      APP_INVALID_QR: 'Mã QR đã hết hạn hoặc không hợp lệ. Vui lòng quét lại mã 30s đang phát.',
      APP_SHIFT_LOCKED: 'Ca điểm danh này đã được chốt và khóa sổ.',
    };
    if (appMessages[error?.message]) return appMessages[error.message];
    if (code === '23505') return 'Mã sinh viên hoặc hồ sơ này đã được sử dụng.';
    if (code === 'PROFILE_MISSING') return 'Tài khoản chưa được cấp hồ sơ hoặc đã bị khóa. Vui lòng liên hệ quản trị viên.';
    if (code === 'invalid_credentials') return 'Email hoặc mật khẩu chưa đúng.';
    if (code === 'email_not_confirmed') return 'Email tài khoản chưa được xác nhận. Vui lòng liên hệ quản trị viên.';
    if (code === 'weak_password') return 'Mật khẩu chưa đạt yêu cầu bảo mật của hệ thống. Hãy chọn mật khẩu mạnh hơn.';
    if (code === 'same_password') return 'Mật khẩu mới cần khác mật khẩu đang dùng.';
    if (code === 'otp_expired' || code === 'AUTH_LINK_REQUIRED' || error?.name === 'AuthImplicitGrantRedirectError') return 'Liên kết không hợp lệ hoặc đã hết hạn. Hãy yêu cầu liên kết mới qua email.';
    if (code === 'SESSION_CHANGED' || code === 'reauthentication_needed' || code === 'reauthentication_not_valid') return 'Phiên xác nhận đã thay đổi hoặc hết hạn. Hãy mở liên kết mới trong email.';
    if (code === 'email_address_not_authorized') return 'Dịch vụ gửi email chưa cho phép địa chỉ này. Chủ dự án cần kiểm tra cấu hình gửi email.';
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
    if (!value || !/^(admin|app|checkin|schedule)\.html(?:\?[^#]*)?$/.test(value)) return null;
    const url = new URL(value, root.location.href);
    if (url.pathname.endsWith('/checkin.html')) {
      const token = url.searchParams.get('t');
      return token ? `checkin.html?t=${encodeURIComponent(token.slice(0, 2048))}` : 'checkin.html';
    }
    return value.split('?')[0];
  }
  function destination(profile) {
    const next = safeNext(new URLSearchParams(root.location.search).get('next'));
    if (next && (!['admin.html','schedule.html'].includes(next) || adminRoles.includes(profile.role))) return next;
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
    let redirecting = false;
    function leavePage() {
      if (redirecting) return;
      redirecting = true;
      document.getElementById('protected-content')?.setAttribute('hidden', '');
      root.location.replace('index.html');
    }
    button?.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const result = await client.auth.signOut({ scope: 'local' });
        if (result.error) throw result.error;
        leavePage();
      } catch (error) { setStatus(statusElement, message(error), true); button.disabled = false; }
    });
    client.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        leavePage();
      }
    });
  }
  root.Attendance = Object.freeze({ client, identity, requireIdentity, bindLogout, destination, safeNext, checkResult, setStatus, message, adminRoles, roleLabels });
})(globalThis);
