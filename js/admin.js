(function () {
  'use strict';
  const api = window.Attendance;
  const status = document.getElementById('page-status');
  const content = document.getElementById('protected-content');
  const retry = document.getElementById('retry-page');
  if (!api) { status.textContent = 'Không tải được hệ thống. Vui lòng tải lại trang.'; return; }
  const pageSize = 20;
  const state = { section: 'profiles', profiles: { page: 0, filter: '' }, audits: { page: 0, filter: '' }, version: 0 };
  let controller;
  let authenticated = false;
  let currentProfile;
  window.AttendanceAdmin = Object.freeze({ reload: load, getCurrent: () => currentProfile });
  api.bindLogout(status);
  const text = (tag, value, className) => {
    const element = document.createElement(tag); element.textContent = value ?? '';
    if (className) element.className = className;
    return element;
  };
  function paginate(section, count, length) {
    const { page } = state[section];
    document.getElementById(`${section}-prev`).disabled = page === 0;
    document.getElementById(`${section}-next`).disabled = (page + 1) * pageSize >= count;
    document.getElementById(`${section}-count`).textContent = `${count} bản ghi`;
    document.getElementById(`${section}-page`).textContent = count ? `${page * pageSize + 1}–${page * pageSize + length} / ${count}` : '0 bản ghi';
    document.getElementById(`${section}-empty`).hidden = length !== 0;
  }
  async function load() {
    const version = ++state.version;
    controller?.abort(); controller = new AbortController();
    const signal = controller.signal;
    const section = state.section;
    const params = { ...state[section] };
    document.getElementById(`${section}-body`).replaceChildren();
    document.getElementById(`${section}-empty`).hidden = true;
    for (const name of ['prev', 'next']) document.getElementById(`${section}-${name}`).disabled = true;
    api.setStatus(status, 'Đang tải dữ liệu…'); retry.hidden = true;
    try {
      const current = await api.requireIdentity(api.adminRoles);
      if (!current || version !== state.version) return;
      authenticated = true;
      currentProfile = current.profile;
      document.getElementById('signed-in-name').textContent = `${current.profile.displayName} (${current.profile.studentId})`;
      document.getElementById('account-role').textContent = api.roleLabels[current.profile.role];
      content.hidden = false;
      let query;
      if (section === 'profiles') {
        query = api.client.from('profiles').select('id,student_id,display_name,role,active,updated_at', { count: 'exact' }).order('student_id');
        if (params.filter) query = query.ilike(/^\d+$/.test(params.filter) ? 'student_id' : 'display_name', `%${params.filter}%`);
      } else {
        query = api.client.from('audit_logs').select('id,actor_id,action,details,created_at', { count: 'exact' }).order('created_at', { ascending: false }).order('id', { ascending: false });
        if (params.filter) query = query.eq('action', params.filter);
      }
      const result = await query.range(params.page * pageSize, (params.page + 1) * pageSize - 1).abortSignal(signal);
      if (version !== state.version) return;
      api.checkResult(result);
      const rows = result.data || [];
      const count = result.count ?? rows.length;
      if (!rows.length && count && params.page > 0) { state[section].page = 0; return load(); }
      const body = document.getElementById(`${section}-body`);
      let actors = new Map();
      if (section === 'audits' && rows.length) {
        const ids = [...new Set(rows.map(row => row.actor_id).filter(Boolean))];
        if (ids.length) {
          const lookup = await api.client.from('profiles').select('id,student_id,display_name').in('id', ids).abortSignal(signal);
          if (version !== state.version) return;
          api.checkResult(lookup);
          actors = new Map((lookup.data || []).map(row => [row.id, `${row.display_name} (${row.student_id})`]));
        }
      }
      rows.forEach(row => {
        const tr = document.createElement('tr');
        if (section === 'profiles') {
          tr.append(text('td', row.student_id), text('td', row.display_name), text('td', api.roleLabels[row.role] || row.role));
          const cell = document.createElement('td'); cell.append(text('span', row.active ? 'Đang hoạt động' : 'Đã khóa', row.active ? 'badge' : 'badge disabled')); tr.append(cell);
          const actionCell = document.createElement('td'); const edit = text('button', 'Sửa', 'secondary');
          edit.type = 'button'; edit.setAttribute('aria-label', `Sửa hồ sơ ${row.student_id}`);
          edit.disabled = currentProfile.role !== 'super_admin' && row.role !== 'student';
          edit.addEventListener('click', () => window.AttendanceMembers?.open(row)); actionCell.append(edit); tr.append(actionCell);
        } else {
          const date = new Date(row.created_at);
          const formatted = Number.isNaN(date.getTime()) ? 'Không rõ' : new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' }).format(date);
          const actions = { 'profile.bootstrap_super_admin': 'Khởi tạo quản trị cao nhất', 'profile.provision': 'Cấp hồ sơ sinh viên', 'profile.update': 'Cập nhật hồ sơ', 'schedule.update': 'Cập nhật lịch tuần', 'schedule.rollback': 'Khôi phục lịch tuần' };
          const action = actions[row.action] || row.action;
          tr.append(text('td', formatted), text('td', action), text('td', actors.get(row.actor_id) || 'Không còn hồ sơ'));
          const td = document.createElement('td'); const details = document.createElement('details');
          details.append(text('summary', 'Xem chi tiết'), text('pre', JSON.stringify(row.details, null, 2))); td.append(details); tr.append(td);
        }
        body.append(tr);
      });
      paginate(section, count, rows.length);
      api.setStatus(status);
    } catch (error) {
      if (version !== state.version || signal.aborted) return;
      if (error.code === 'PROFILE_MISSING') { content.hidden = true; authenticated = false; }
      api.setStatus(status, api.message(error), true); retry.hidden = false;
    }
  }
  document.querySelectorAll('[data-section]').forEach(button => button.addEventListener('click', () => {
    state.section = button.dataset.section;
    document.querySelectorAll('[data-section]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    document.getElementById('profiles-panel').hidden = state.section !== 'profiles';
    document.getElementById('audits-panel').hidden = state.section !== 'audits';
    load();
  }));
  for (const section of ['profiles', 'audits']) {
    document.getElementById(`${section}-filter`).addEventListener('submit', event => {
      event.preventDefault(); state[section].page = 0;
      state[section].filter = document.getElementById(section === 'profiles' ? 'profile-search' : 'audit-action').value.trim(); load();
    });
    document.getElementById(`${section}-prev`).addEventListener('click', () => { if (state[section].page > 0) { state[section].page--; load(); } });
    document.getElementById(`${section}-next`).addEventListener('click', () => { state[section].page++; load(); });
  }
  document.getElementById('reload').addEventListener('click', load);
  retry.addEventListener('click', load);
  window.addEventListener('focus', () => { if (authenticated) load(); });
  load();
})();
