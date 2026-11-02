// Cookie HttpOnly giữ phiên; chỉ CSRF token và thông tin hiển thị nằm trong RAM.
(() => {
  'use strict';
  let user = null;
  let csrfToken = '';
  let revision = 0;
  localStorage.removeItem('adminPass');

  function headers() {
    return { 'Content-Type': 'application/json', ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}) };
  }

  function applySession(result) {
    if (!result?.data || !['admin', 'superadmin'].includes(result.data.role) || typeof result.csrfToken !== 'string') {
      throw new Error('Phiên đăng nhập không hợp lệ.');
    }
    user = result.data;
    csrfToken = result.csrfToken;
    localStorage.setItem('adminUser', user.userId);
    localStorage.setItem('adminName', (user.name || user.userId));
    localStorage.setItem('adminRole', user.role);
    updateAdminUI(user);
    hideAdminOverlay();
  }

  function expire() {
    revision += 1;
    user = null;
    csrfToken = '';
    for (const key of ['adminUser', 'adminName', 'adminRole', 'adminPass']) localStorage.removeItem(key);
    updateAdminUI(null);
    showAdminOverlay();
  }

  async function restore() {
    const requestRevision = ++revision;
    try {
      const response = await fetch('/api/admin/verify', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000) });
      const result = await response.json();
      if (requestRevision !== revision) return false;
      if (!response.ok || !result.success) { expire(); return false; }
      applySession(result);
      await fetchAllData();
      return true;
    } catch {
      if (requestRevision === revision) expire();
      return false;
    }
  }

  async function login(event) {
    event.preventDefault();
    const userId = document.getElementById('adminUserIdInput').value.trim().toUpperCase();
    const password = document.getElementById('adminPasswordInput').value;
    const button = document.getElementById('adminLoginBtn');
    const alert = document.getElementById('adminAuthAlert');
    const alertText = document.getElementById('adminAuthAlertText');
    if (!userId || !password) return;
    const requestRevision = ++revision;
    button.disabled = true;
    button.textContent = 'Đang đăng nhập...';
    alert?.classList.add('hidden');
    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, password }), signal: AbortSignal.timeout(15000),
      });
      const result = await response.json();
      if (requestRevision !== revision) return;
      if (!response.ok || !result.success) throw new Error(result.message || 'Đăng nhập không thành công.');
      applySession(result);
      document.getElementById('adminPasswordInput').value = '';
      await fetchAllData();
    } catch (error) {
      if (requestRevision !== revision) return;
      if (alertText) alertText.textContent = error.name === 'TimeoutError' ? 'Kết nối quá thời gian. Vui lòng thử lại.' : error.message;
      alert?.classList.remove('hidden');
    } finally {
      button.disabled = false;
      button.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Đăng Nhập Quản Trị';
    }
  }

  async function logout() {
    if (!user) { expire(); return; }
    try {
      const response = await fetch('/api/admin/logout', {
        method: 'POST', credentials: 'same-origin', headers: headers(), signal: AbortSignal.timeout(15000),
      });
      if (!response.ok && response.status !== 401) throw new Error('Chưa đăng xuất được. Vui lòng thử lại.');
      expire();
    } catch (error) {
      showToast.error(error.message || 'Chưa đăng xuất được. Vui lòng thử lại.');
    }
  }

  async function changePassword(currentPassword, newPassword) {
    const response = await fetch('/api/admin/change-password', {
      method: 'POST', credentials: 'same-origin', headers: headers(),
      body: JSON.stringify({ currentPassword, newPassword }), signal: AbortSignal.timeout(15000),
    });
    const result = await response.json();
    if (response.status === 401) expire();
    if (!response.ok || !result.success) throw new Error(result.message || 'Chưa đổi được mật khẩu.');
    applySession(result);
    return result;
  }

  function openPasswordDialog() {
    if (!user || document.getElementById('adminPasswordDialog')) return;
    const previousFocus = document.activeElement;
    const overlay = document.createElement('div');
    overlay.id = 'adminPasswordDialog';
    overlay.className = 'fixed inset-0 z-[10000] bg-slate-950/80 flex items-center justify-center p-4';
    overlay.innerHTML = `<form class="bg-slate-900 border border-slate-700 rounded-2xl p-5 w-full max-w-sm space-y-4" role="dialog" aria-modal="true" aria-labelledby="adminPasswordDialogTitle">
      <h2 id="adminPasswordDialogTitle" class="font-bold text-white">Đổi mật khẩu quản trị</h2>
      <label class="block text-xs text-slate-300">Mật khẩu hiện tại<input id="currentAdminPassword" type="password" autocomplete="current-password" required maxlength="256" class="mt-1 block w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white" /></label>
      <label class="block text-xs text-slate-300">Mật khẩu mới (10–128 ký tự)<input id="newAdminPassword" type="password" autocomplete="new-password" required minlength="10" maxlength="128" class="mt-1 block w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white" /></label>
      <label class="block text-xs text-slate-300">Nhập lại mật khẩu mới<input id="confirmAdminPassword" type="password" autocomplete="new-password" required minlength="10" maxlength="128" class="mt-1 block w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white" /></label>
      <p class="text-xs text-slate-400">Sau khi đổi, các phiên đăng nhập trên thiết bị khác sẽ kết thúc.</p>
      <p id="adminPasswordChangeError" class="text-xs text-rose-300" role="alert"></p>
      <div class="flex justify-end gap-2"><button type="button" id="cancelPasswordChange" class="px-3 py-2 text-xs text-slate-300 rounded-lg border border-slate-700">Hủy</button><button type="submit" class="px-3 py-2 text-xs text-white bg-teal-600 rounded-lg">Đổi mật khẩu</button></div>
    </form>`;
    document.body.appendChild(overlay);
    let saving = false;
    const form = overlay.querySelector('form');
    const controls = [...form.querySelectorAll('input, button')];
    const close = () => {
      if (saving) return;
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      previousFocus?.focus();
    };
    function onKey(event) {
      if (event.key === 'Escape') close();
      if (event.key === 'Tab') {
        const focusable = controls.filter(control => !control.disabled);
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener('keydown', onKey);
    overlay.querySelector('#cancelPasswordChange').onclick = close;
    form.onsubmit = async event => {
      event.preventDefault();
      if (saving) return;
      const current = form.querySelector('#currentAdminPassword').value;
      const next = form.querySelector('#newAdminPassword').value;
      const confirmation = form.querySelector('#confirmAdminPassword').value;
      const errorText = form.querySelector('#adminPasswordChangeError');
      if (next !== confirmation) { errorText.textContent = 'Hai mật khẩu mới chưa khớp.'; return; }
      errorText.textContent = '';
      saving = true;
      controls.forEach(control => { control.disabled = true; });
      try {
        const result = await changePassword(current, next);
        saving = false;
        close();
        showToast.success(result.message);
      } catch (error) {
        errorText.textContent = error.message;
      } finally {
        saving = false;
        controls.forEach(control => { control.disabled = false; });
      }
    };
    form.querySelector('input').focus();
  }

  window.getAdminUser = () => user?.userId || localStorage.getItem('adminUser') || '';
  window.getAdminPassword = () => '';
  window.getAdminHeaders = headers;
  window.checkAdminAuthOnLoad = restore;
  window.handleAdminLoginSubmit = login;
  window.handleAdminLogout = logout;
  window.AdminAuth = {
    isAuthenticated: () => Boolean(user), getUser: () => user,
    headers, expire, changePassword, openPasswordDialog, ready: null,
  };
  window.AdminAuth.ready = restore();
})();
