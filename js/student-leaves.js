/* Đơn nghỉ của UID đang đăng nhập; không gửi MSSV hoặc nhận vai trò từ storage. */
(function (root) {
  'use strict';
  const api = root.Attendance;
  if (!api) return;
  const el = id => document.getElementById(id);
  const status = (text, error = false) => api.setStatus(el('my-leave-status'), text, error);
  const labels = { pending: 'Chờ duyệt', reviewing: 'Cần đối chiếu', approved: 'Đã chấp thuận', rejected: 'Đã từ chối' };
  const messages = {
    APP_LEAVE_DATE_RANGE: 'Chỉ xin nghỉ từ hôm nay đến tối đa 30 ngày tới.',
    APP_LEAVE_OWNERSHIP: 'Đơn cũ chưa khớp hồ sơ. Vui lòng liên hệ quản trị viên để đối chiếu.',
    APP_LEAVE_ATTENDANCE_CONFLICT: 'Ca đã có điểm danh hoặc đã khóa. Không gửi được đơn mới.',
    APP_SHIFT_LOCKED: 'Ca đã chốt hoặc hết giờ nhận đơn.',
  };
  let current = null, caps = null, loading = false, sending = false, requestGeneration = 0;
  function message(error) {
    for (const [code, text] of Object.entries(messages)) if (String(error?.message).includes(code)) return text;
    return api.message(error);
  }
  function controls() {
    el('send-leave').disabled = sending || caps?.leaveEnabled !== true;
    for (const id of ['my-leave-date','my-leave-shift','my-leave-reason']) el(id).disabled = sending || caps?.leaveEnabled !== true;
  }
  async function rpc(name, args) { return api.checkResult(await api.client.rpc(name, args)).data; }
  async function capability(generation = requestGeneration) {
    caps = null; controls();
    try {
      const result = await rpc('get_leave_capabilities');
      if (generation !== requestGeneration) return;
      if (result?.version !== 1 || result.profileId !== current.profile.id || !/^\d{4}-\d{2}-\d{2}$/.test(result.minDate)
        || !/^\d{4}-\d{2}-\d{2}$/.test(result.maxDate)) throw new Error('Invalid capability response');
      caps = result;
      el('my-leave-date').min = result.minDate; el('my-leave-date').max = result.maxDate;
      if (!el('my-leave-date').value) el('my-leave-date').value = result.minDate;
      el('leave-availability').textContent = result.leaveEnabled ? 'Gửi đơn để quản trị viên xét duyệt. Chỉ đơn đã chấp thuận mới tính nghỉ có phép.'
        : 'Gửi đơn đang tạm dừng để cập nhật.';
    } catch (error) {
      el('leave-availability').textContent = ['PGRST202','42501'].includes(error?.code)
        ? 'Gửi đơn đang chờ quản trị viên hoàn tất cập nhật.' : message(error);
    }
    controls();
  }
  async function history(generation = requestGeneration) {
    el('my-leaves-list').replaceChildren();
    const result = api.checkResult(await api.client.from('leave_requests')
      .select('id,profile_id,date,shift,reason,status,review_reason,created_at,reviewed_at')
      .eq('profile_id', current.profile.id).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(50));
    if (generation !== requestGeneration) return;
    if (!Array.isArray(result.data)) throw new Error('Invalid leave list');
    for (const leave of result.data) {
      if (leave.profile_id !== current.profile.id) throw new Error('Invalid leave owner');
      const item = document.createElement('article'); item.className = 'status';
      for (const text of [`${leave.date} · Ca ${leave.shift} · ${labels[leave.status] || leave.status}`,
        `Lý do: ${leave.reason}`, ...(leave.review_reason ? [`Phản hồi: ${leave.review_reason}`] : [])]) {
        const p = document.createElement('p'); p.textContent = text; item.append(p);
      }
      el('my-leaves-list').append(item);
    }
    el('my-leaves-summary').textContent = result.data.length ? 'Tối đa 50 đơn gần nhất của bạn.' : 'Bạn chưa có đơn xin nghỉ.';
  }
  async function load() {
    if (loading || sending) return;
    loading = true; const generation = ++requestGeneration; el('reload-leaves').disabled = true;
    try {
      current = await api.requireIdentity(); if (!current) return;
      el('student-leaves-panel').hidden = false;
      await capability(generation);
      if (generation !== requestGeneration) return;
      await history(generation);
    } catch (error) { caps = null; status(message(error), true); }
    finally { loading = false; el('reload-leaves').disabled = false; controls(); }
  }
  el('leave-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (sending || caps?.leaveEnabled !== true) return;
    sending = true; controls(); status('Đang gửi đơn…');
    const generation = requestGeneration;
    try {
      const identity = await api.identity();
      if (!identity || identity.profile.id !== current.profile.id) throw { code: 'SESSION_CHANGED' };
      await capability(generation);
      if (generation !== requestGeneration || caps?.leaveEnabled !== true) throw { code: 'SESSION_CHANGED' };
      const result = await rpc('student_create_leave_request', { p_date: el('my-leave-date').value,
        p_shift: el('my-leave-shift').value, p_reason: el('my-leave-reason').value.trim() });
      if (generation !== requestGeneration) return;
      if (result?.success !== true || result.data?.profile_id !== current.profile.id || !result.data?.id
        || !Object.hasOwn(labels, result.data.status)) throw new Error('Invalid leave response');
      status(result.alreadySubmitted ? 'Bạn đã có đơn cho ca này. Đơn đã lưu được giữ nguyên.' : 'Đã gửi đơn. Đang chờ quản trị viên duyệt.');
      el('my-leave-reason').value = '';
      await history(generation);
    } catch (error) { status(message(error), true); }
    finally { sending = false; controls(); }
  });
  el('reload-leaves').addEventListener('click', () => void load());
  api.client.auth.onAuthStateChange(event => {
    if (event === 'SIGNED_OUT' || event === 'SIGNED_IN') {
      requestGeneration++; caps = null; controls(); el('my-leaves-list').replaceChildren();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { caps = null; controls(); }
    else void load();
  });
  setInterval(() => {
    if (!document.hidden && !el('leave-form').contains(document.activeElement)) void load();
  }, 30000);
  void load();
})(globalThis);
