(async function () {
  'use strict';
  const api = window.Attendance;
  const status = document.getElementById('reset-status');
  const requestSection = document.getElementById('recovery-request');
  const requestForm = document.getElementById('recovery-form');
  const requestButton = document.getElementById('send-recovery');
  const passwordForm = document.getElementById('password-form');
  const passwordButton = document.getElementById('save-password');
  const password = document.getElementById('new-password');
  const confirmation = document.getElementById('confirm-password');
  if (!api) { status.textContent = 'Không tải được hệ thống. Vui lòng tải lại trang.'; return; }
  let userId = null;
  let busy = false;
  let nextRequestAt = 0;

  function showRequest() {
    passwordForm.hidden = true; requestSection.hidden = false; requestButton.disabled = false;
  }
  requestForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy || Date.now() < nextRequestAt || !requestForm.reportValidity()) return;
    busy = true; requestButton.disabled = true;
    api.setStatus(status, 'Đang gửi yêu cầu…');
    try {
      const email = document.getElementById('recovery-email').value.trim();
      const redirectTo = new URL('reset-password.html', window.location.href).href;
      const result = await api.client.auth.resetPasswordForEmail(email, { redirectTo });
      if (result.error) throw result.error;
      nextRequestAt = Date.now() + 60000;
      api.setStatus(status, 'Yêu cầu đã được tiếp nhận. Nếu email có tài khoản, bạn sẽ nhận được thư để thiết lập mật khẩu. Hãy kiểm tra cả thư mục Spam.');
      requestButton.textContent = 'Có thể gửi lại sau 60 giây';
      window.setTimeout(() => { requestButton.disabled = false; requestButton.textContent = 'Gửi liên kết qua email'; }, 60000);
    } catch (error) {
      api.setStatus(status, api.message(error), true); requestButton.disabled = false;
    } finally { busy = false; }
  });
  passwordForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy || !userId || !passwordForm.reportValidity()) return;
    if (password.value !== confirmation.value) {
      api.setStatus(status, 'Hai lần nhập mật khẩu chưa khớp.', true); confirmation.focus(); return;
    }
    busy = true; passwordButton.disabled = true;
    api.setStatus(status, 'Đang lưu mật khẩu…');
    try {
      // Xác minh lại danh tính với Auth trước khi thay mật khẩu cho chính phiên hiện tại.
      const verified = await api.client.auth.getUser();
      if (verified.error) throw verified.error;
      if (verified.data.user?.id !== userId) throw Object.assign(new Error('Session changed'), { code: 'SESSION_CHANGED' });
      const result = await api.client.auth.updateUser({ password: password.value });
      if (result.error) throw result.error;
      if (result.data?.user?.id !== userId) throw Object.assign(new Error('APP_PASSWORD_UPDATE_UNCONFIRMED'), { code: 'APP_PASSWORD_UPDATE_UNCONFIRMED' });
      passwordForm.hidden = true; requestSection.hidden = true;
      const signOut = await api.client.auth.signOut({ scope: 'local' });
      api.setStatus(status, signOut.error
        ? 'Mật khẩu đã được lưu. Chưa kết thúc được phiên hiện tại; bạn có thể quay lại trang đăng nhập.'
        : 'Mật khẩu đã được lưu. Bạn có thể quay lại đăng nhập bằng mật khẩu mới.');
    } catch (error) {
      api.setStatus(status, api.message(error), true);
      if (error.status === 401 || error.status === 403 || error.code === 'SESSION_CHANGED' || error.name === 'AuthSessionMissingError') showRequest();
    } finally {
      password.value = ''; confirmation.value = ''; busy = false; passwordButton.disabled = false;
    }
  });
  try {
    const initialized = await api.client.auth.initialize();
    if (initialized.error) throw initialized.error;
    const session = await api.client.auth.getSession();
    if (session.error) throw session.error;
    if (!session.data.session) { showRequest(); api.setStatus(status); return; }
    const verified = await api.client.auth.getUser();
    if (verified.error) throw verified.error;
    if (!verified.data.user?.id) throw Object.assign(new Error('Auth link required'), { code: 'AUTH_LINK_REQUIRED' });
    userId = verified.data.user.id;
    document.getElementById('verified-email').textContent = `Tài khoản: ${verified.data.user.email || ''}`;
    passwordForm.hidden = false; requestSection.hidden = true; api.setStatus(status);
  } catch (error) { showRequest(); api.setStatus(status, api.message(error), true); }
  finally {
    // SDK đã xử lý callback; bỏ fragment để token không còn nằm trong thanh địa chỉ.
    window.history.replaceState(null, '', window.location.pathname);
  }
})();
