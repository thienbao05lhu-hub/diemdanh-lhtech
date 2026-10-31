(function () {
  'use strict';
  const api = window.Attendance;
  if (!api) return;
  const dialog = document.getElementById('member-dialog');
  const form = document.getElementById('member-form');
  const status = document.getElementById('member-status');
  const submit = document.getElementById('save-member');
  let editing = null;
  let busy = false;
  let opening = false;
  async function open(row = null) {
    if (busy || opening || dialog.open) return;
    opening = true;
    try {
      const current = await api.requireIdentity(api.adminRoles); if (!current) return;
      editing = row; form.reset(); api.setStatus(status);
      const owner = current.profile.role === 'super_admin';
      document.getElementById('member-dialog-title').textContent = row ? 'Chỉnh sửa hồ sơ' : 'Cấp hồ sơ sinh viên';
      document.getElementById('member-email-field').hidden = !!row;
      document.getElementById('member-email').required = !row;
      document.getElementById('member-student-id').value = row?.student_id || '';
      document.getElementById('member-student-id').readOnly = !!row;
      document.getElementById('member-name').value = row?.display_name || '';
      document.getElementById('member-role-field').hidden = !row;
      document.getElementById('member-role').value = row?.role || 'student';
      document.getElementById('member-role').disabled = !owner || row?.id === current.profile.id;
      document.getElementById('member-active-field').hidden = !row;
      document.getElementById('member-active').checked = row?.active ?? true;
      document.getElementById('member-active').disabled = row?.id === current.profile.id;
      submit.textContent = row ? 'Lưu hồ sơ' : 'Cấp hồ sơ'; dialog.showModal();
    } catch(error) { api.setStatus(document.getElementById('page-status'), api.message(error), true); }
    finally { opening = false; }
  }
  function close() { if (!busy) dialog.close(); }
  document.getElementById('add-member').addEventListener('click', () => open());
  document.getElementById('close-member').addEventListener('click', close);
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (busy || !form.reportValidity()) return;
    const name = document.getElementById('member-name').value.trim();
    if (!name) { api.setStatus(status, 'Họ và tên không được để trống.', true); return; }
    busy = true; submit.disabled = true; document.getElementById('close-member').disabled = true;
    api.setStatus(status, 'Đang lưu hồ sơ…');
    try {
      const current = await api.requireIdentity(api.adminRoles); if (!current) return;
      const result = editing
        ? await api.client.rpc('admin_update_profile', { p_id: editing.id, p_display_name: name,
          p_role: document.getElementById('member-role').value, p_active: document.getElementById('member-active').checked,
          p_expected_updated_at: editing.updated_at })
        : await api.client.rpc('admin_provision_profile', { p_email: document.getElementById('member-email').value.trim(),
          p_student_id: document.getElementById('member-student-id').value.trim(), p_display_name: name });
      api.checkResult(result); dialog.close(); await window.AttendanceAdmin?.reload();
    } catch(error) { api.setStatus(status, api.message(error), true); }
    finally { busy = false; submit.disabled = false; document.getElementById('close-member').disabled = false; }
  });
  window.AttendanceMembers = Object.freeze({ open });
})();
