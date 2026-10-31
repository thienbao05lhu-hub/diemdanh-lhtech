(function () {
  'use strict';
  const api = window.Attendance;
  const status = document.getElementById('page-status');
  const content = document.getElementById('protected-content');
  const retry = document.getElementById('retry-page');
  if (!api) { status.textContent = 'Không tải được hệ thống. Vui lòng tải lại trang.'; return; }
  api.bindLogout(status);
  let busy = false;
  async function load() {
    if (busy) return; busy = true; retry.hidden = true;
    api.setStatus(status, 'Đang kiểm tra tài khoản…');
    try {
      const current = await api.requireIdentity();
      if (!current) return;
      const profile = current.profile;
      document.getElementById('profile-name').textContent = profile.displayName;
      const id = document.getElementById('profile-student-id'); if (id) id.textContent = profile.studentId;
      const role = document.getElementById('profile-role'); if (role) role.textContent = api.roleLabels[profile.role];
      const link = document.getElementById('admin-link'); if (link) link.hidden = !api.adminRoles.includes(profile.role);
      content.hidden = false; api.setStatus(status);
    } catch (error) { content.hidden = true; api.setStatus(status, api.message(error), true); retry.hidden = false; }
    finally { busy = false; }
  }
  retry.addEventListener('click', load);
  window.addEventListener('focus', load);
  load();
})();
