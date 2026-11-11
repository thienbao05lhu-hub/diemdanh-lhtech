/* Đơn nghỉ của UID đang đăng nhập; không gửi MSSV hoặc nhận vai trò từ storage. */
(function (root) {
  'use strict';
  const api = root.Attendance;
  if (!api) return;
  const el = id => document.getElementById(id);
  const status = (text, error = false) => { el('myLeaveRequestsNotice').textContent = text; if (error) root.showToast?.warning(text); };
  const colors = { approved: 'text-emerald-300', rejected: 'text-rose-300', pending: 'text-amber-300', reviewing: 'text-blue-300' };
  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = String(text);
    return element;
  }

  function cardFor(request, admin = false) {
    const card = node('article', 'rounded-xl border border-slate-700/70 bg-slate-950/50 p-3 space-y-2');
    const heading = node('div', 'flex items-start justify-between gap-3');
    const title = node('div', 'min-w-0');
    if (admin) title.append(node('p', 'font-semibold text-xs text-white break-words', `${request.userName} · ${request.userId}`));
    title.append(node('p', 'text-xs text-slate-300', `${request.date.split('-').reverse().join('/')} · Ca ${request.shift}`));
    const isLate = (request.request_type || request.requestType) === 'late';
    const typeBadge = isLate
      ? node('span', 'inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-md bg-orange-500/15 text-orange-400 border border-orange-500/30', `⏰ Xin đi trễ (${request.late_minutes || request.lateMinutes || 15}p)`)
      : node('span', 'inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-400 border border-amber-500/30', '📝 Báo nghỉ phép');
    const badgeRow = node('div', 'flex items-center gap-1.5 mt-1');
    badgeRow.append(typeBadge);
    title.append(badgeRow);
    heading.append(title, node('span', `text-[11px] font-semibold shrink-0 ${colors[request.status] || 'text-slate-300'}`, labels[request.status] || request.status));
    card.append(heading, node('p', 'text-xs text-slate-300 whitespace-pre-wrap break-words', `Lý do: ${request.reason}`));
    if (request.reviewReason) card.append(node('p', 'text-[11px] text-slate-400 whitespace-pre-wrap break-words', `Phản hồi: ${request.reviewReason}`));
    if (request.reviewedAt) card.append(node('p', 'text-[10px] text-slate-500', `Xử lý bởi ${request.reviewedByName || request.reviewedBy} · ${new Date(request.reviewedAt).toLocaleString('vi-VN')}`));
    return card;
  }
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
    el('btnConfirmLeave').disabled = sending || caps?.leaveEnabled !== true;
    el('btnOpenLeave').disabled = caps?.leaveEnabled !== true;
    for (const id of ['leaveDate','leaveShift','leaveReason','leaveLateMinutes']) if (el(id)) el(id).disabled = sending || caps?.leaveEnabled !== true;
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
      el('leaveDate').min = result.minDate; el('leaveDate').max = result.maxDate;
      if (!el('leaveDate').value) el('leaveDate').value = result.minDate;
      el('myLeaveRequestsNotice').textContent = result.leaveEnabled ? 'Gửi đơn để quản trị viên xét duyệt. Chỉ đơn đã chấp thuận mới tính có phép.'
        : 'Gửi đơn đang tạm dừng để cập nhật.';
    } catch (error) {
      el('myLeaveRequestsNotice').textContent = ['PGRST202','42501'].includes(error?.code)
        ? 'Gửi đơn đang chờ quản trị viên hoàn tất cập nhật.' : message(error);
    }
    controls();
  }
  async function history(generation = requestGeneration) {
    el('myLeaveRequestsList').replaceChildren();
    const result = api.checkResult(await api.client.from('leave_requests')
      .select('id,profile_id,date,shift,reason,status,review_reason,created_at,reviewed_at,reviewed_by,reviewed_by_name,request_type,late_minutes')
      .eq('profile_id', current.profile.id).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(50));
    if (generation !== requestGeneration) return;
    if (!Array.isArray(result.data)) throw new Error('Invalid leave list');
    for (const leave of result.data) {
      if (leave.profile_id !== current.profile.id) throw new Error('Invalid leave owner');
      el('myLeaveRequestsList').append(cardFor({ ...leave, reviewReason: leave.review_reason, reviewedAt: leave.reviewed_at, reviewedBy: leave.reviewed_by, reviewedByName: leave.reviewed_by_name }));
    }
    el('myLeaveRequestsNotice').textContent = (caps?.leaveEnabled ? '' : 'Gửi đơn đang chờ cập nhật. ') + (result.data.length ? 'Các đơn gần đây của bạn. Chỉ đơn được chấp thuận mới tính có phép.' : 'Bạn chưa có đơn xin nghỉ hoặc xin đi trễ.');
  }
  async function load() {
    if (loading || sending) return;
    loading = true; const generation = ++requestGeneration; el('btnRefreshMyLeaves').disabled = true;
    try {
      current = await api.requireIdentity(); if (!current) return;

      await capability(generation);
      if (generation !== requestGeneration) return;
      await history(generation);
    } catch (error) {
      caps = null;
      status(message(error), true);
      if (error?.code === 'NETWORK_ERROR' || error?.name === 'TypeError' || error?.status === 0 || String(error?.message).includes('network')) {
        setTimeout(() => { if (!document.hidden && current) void load(); }, 2500);
      }
    }
    finally { loading = false; el('btnRefreshMyLeaves').disabled = false; controls(); }
  }
  root.toggleLeaveTypeFields = () => {
    const typeEl = document.querySelector('input[name="leaveType"]:checked');
    const isLate = (typeEl ? typeEl.value : 'leave') === 'late';

    const lblLeave = el('leaveTypeLabel_leave');
    const lblLate = el('leaveTypeLabel_late');
    if (lblLeave && lblLate) {
      if (isLate) {
        lblLeave.className = 'flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg text-xs font-semibold cursor-pointer transition text-slate-400';
        lblLate.className = 'flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg text-xs font-semibold cursor-pointer transition text-orange-400 bg-orange-500/20 border border-orange-500/30';
      } else {
        lblLeave.className = 'flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg text-xs font-semibold cursor-pointer transition text-amber-300 bg-amber-500/20 border border-amber-500/30';
        lblLate.className = 'flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg text-xs font-semibold cursor-pointer transition text-slate-400';
      }
    }

    const wrap = el('leaveLateMinutesWrap');
    if (wrap) wrap.classList.toggle('hidden', !isLate);

    const reasonLabel = el('leaveReasonLabel');
    if (reasonLabel) {
      reasonLabel.innerHTML = isLate
        ? 'Lý Do Xin Đi Trễ <span class="text-slate-500 font-normal lowercase">(bắt buộc)</span>'
        : 'Lý Do Xin Nghỉ <span class="text-slate-500 font-normal lowercase">(bắt buộc)</span>';
    }

    const reasonInput = el('leaveReason');
    if (reasonInput) {
      reasonInput.placeholder = isLate
        ? 'Ví dụ: Bận việc đột xuất, kẹt xe, hỏng xe...'
        : 'Ví dụ: Bị ốm, việc gia đình...';
    }

    const btnText = el('btnConfirmLeaveText');
    if (btnText) {
      btnText.textContent = isLate ? 'Xác nhận xin đi trễ' : 'Xác nhận báo nghỉ';
    }
  };

  root.setLateMinutePreset = (mins) => {
    const input = el('leaveLateMinutes');
    if (input) input.value = mins;
  };

  root.handleSendLeaveRequest = async event => {
    event.preventDefault();
    if (sending || caps?.leaveEnabled !== true) return;
    sending = true; controls(); status('Đang gửi đơn…');
    const generation = requestGeneration;
    try {
      const identity = await api.identity();
      if (!identity || identity.profile.id !== current.profile.id) throw { code: 'SESSION_CHANGED' };
      if (!caps) await capability(generation);
      if (generation !== requestGeneration || caps?.leaveEnabled !== true) throw { code: 'SESSION_CHANGED' };

      const typeEl = document.querySelector('input[name="leaveType"]:checked');
      const reqType = typeEl ? typeEl.value : 'leave';
      let lateMins = null;
      if (reqType === 'late') {
        const val = parseInt(el('leaveLateMinutes')?.value, 10);
        lateMins = (Number.isFinite(val) && val >= 1 && val <= 240) ? val : 15;
      }

      const result = await rpc('student_create_leave_request', {
        p_date: el('leaveDate').value,
        p_shift: el('leaveShift').value,
        p_reason: el('leaveReason').value.trim(),
        p_request_type: reqType,
        p_late_minutes: lateMins
      });
      if (generation !== requestGeneration) return;
      if (result?.success !== true || result.data?.profile_id !== current.profile.id || !result.data?.id
        || !Object.hasOwn(labels, result.data.status)) throw new Error('Invalid leave response');
      const actionName = reqType === 'late' ? 'xin đi trễ' : 'xin nghỉ';
      status(result.alreadySubmitted
        ? 'Bạn đã có đơn cho ca này. Đơn đã lưu được giữ nguyên.'
        : `Đã gửi đơn ${actionName} và thông báo tới nhóm Zalo Admin. Đang chờ duyệt.`);
      el('leaveReason').value = '';
      el('leaveModal').classList.add('hidden');
      root.showToast?.success(result.alreadySubmitted
        ? 'Bạn đã có đơn cho ca này.'
        : `Đã gửi đơn ${actionName} & báo về nhóm Zalo Admin.`);
      await history(generation);
    } catch (error) { status(message(error), true); }
    finally { sending = false; controls(); }
  };
  root.openLeaveModal = async () => {
    if (!current) return;
    if (!caps?.leaveEnabled) await capability();
    if (!caps?.leaveEnabled) { root.showToast?.warning('Xin nghỉ đang chờ quản trị viên hoàn tất cập nhật.'); return; }
    el('leaveReason').value = '';
    const leaveRadio = document.querySelector('input[name="leaveType"][value="leave"]');
    if (leaveRadio) leaveRadio.checked = true;
    root.toggleLeaveTypeFields?.();
    el('leaveModal').classList.remove('hidden');
    el('leaveReason').focus();
  };
  root.closeLeaveModal = () => { if (!sending) el('leaveModal').classList.add('hidden'); };
  el('btnRefreshMyLeaves').addEventListener('click', () => void load());
  api.client.auth.onAuthStateChange(event => {
    if (event === 'SIGNED_OUT' || event === 'SIGNED_IN') {
      requestGeneration++; caps = null; controls(); el('myLeaveRequestsList').replaceChildren();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { caps = null; controls(); }
    else {
      setTimeout(() => { if (!document.hidden && current) void load(); }, 400);
    }
  });
  setInterval(() => {
    if (!document.hidden && !el('leaveForm').contains(document.activeElement)) void load();
  }, 30000);
  void load();
})(globalThis);
