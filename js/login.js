(async function () {
  'use strict';
  if (window.AttendanceRedirecting) return;
  const api = window.Attendance;
  const status = document.getElementById('login-status');
  const button = document.getElementById('login-button');
  const form = document.getElementById('login-form');
  const password = document.getElementById('password');
  const toggle = document.getElementById('show-password');
  const retry = document.getElementById('retry-session');
  if (!api) { status.textContent = 'Không tải được hệ thống. Vui lòng tải lại trang.'; return; }
  let busy = false;
  toggle.addEventListener('click', () => {
    const show = password.type === 'password';
    password.type = show ? 'text' : 'password';
    toggle.textContent = show ? 'Ẩn' : 'Hiện';
    toggle.setAttribute('aria-pressed', String(show));
  });
  async function resume() {
    if (busy) return;
    busy = true; button.disabled = true; retry.hidden = true;
    api.setStatus(status, 'Đang kiểm tra phiên đăng nhập…');
    try {
      const current = await api.identity();
      if (current) { window.location.replace(api.destination(current.profile)); return; }
      api.setStatus(status);
    } catch (error) { api.setStatus(status, api.message(error), true); retry.hidden = false; }
    finally { busy = false; button.disabled = false; }
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy || !form.reportValidity()) return;
    busy = true; button.disabled = true; button.textContent = 'Đang đăng nhập…'; retry.hidden = true;
    api.setStatus(status);
    try {
      let emailVal = document.getElementById('email').value.trim();
      const rawMssv = /^\d{8,10}$/.test(emailVal) ? emailVal : (emailVal.includes('@') ? emailVal.split('@')[0] : '');
      if (/^\d{8,10}$/.test(emailVal)) {
        emailVal = `${emailVal}@student.lhu.edu.vn`;
      }
      let signedIn = false;
      try {
        const result = await api.client.auth.signInWithPassword({ email: emailVal, password: password.value });
        if (!result.error && result.data?.session) {
          signedIn = true;
          const current = await api.identity();
          if (current) {
            window.location.replace(api.destination(current.profile));
            return;
          }
        }
      } catch (authErr) {}

      // Fallback: Xác thực qua RPC admin_verify_password (Postgres bcrypt)
      if (rawMssv) {
        try {
          const { data: vData } = await api.client.rpc('admin_verify_password', {
            p_student_id: rawMssv,
            p_password: password.value
          });
          if (vData && vData.success && vData.profile) {
            localStorage.setItem('adminUser', vData.profile.student_id);
            localStorage.setItem('adminName', vData.profile.display_name);
            localStorage.setItem('adminRole', vData.profile.role === 'super_admin' ? 'superadmin' : vData.profile.role);
            window.location.replace(api.destination(vData.profile));
            return;
          }
        } catch (rpcErr) {}
      }

      throw new Error('Sai MSSV hoặc mật khẩu!');
    } catch (error) {
      api.setStatus(status, api.message(error), true);
      if (error.code === 'PROFILE_MISSING') await api.client.auth.signOut({ scope: 'local' }).catch(() => {});
    } finally {
      password.value = ''; password.type = 'password'; toggle.textContent = 'Hiện'; toggle.setAttribute('aria-pressed', 'false');
      busy = false; button.disabled = false; button.textContent = 'Đăng nhập';
    }
  });
  retry.addEventListener('click', resume);
  await resume();
})();
