/* Admin xét duyệt đơn bằng Auth + revision CAS. Không dùng MSSV/reviewer do client tự khai. */
(function (root) {
  'use strict';
  const section = document.getElementById('leaveRequestsSection');
  if (!section) return;
  const el = id => document.getElementById(id);
  const labels = { pending: 'Chờ duyệt', reviewing: 'Cần đối chiếu', approved: 'Đã chấp thuận', rejected: 'Đã từ chối' };
  let page = 1, total = 0, generation = 0, loading = false, deciding = false;
  const draftReasons = new Map();
  const authenticated = () => Boolean(root.AdminAuth?.isAuthenticated());
  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = String(text);
    return element;
  }

  function notice(text) { el('leaveRequestsNotice').textContent = text; }
  function toast(type, text) { root.showToast?.[type]?.(text); notice(text); }
  const colors = { approved: 'text-emerald-300', rejected: 'text-rose-300', pending: 'text-amber-300', reviewing: 'text-blue-300' };

  function createDeleteButton(request, getActionsEl) {
    const delBtn = node(
      'button',
      'rounded-lg bg-slate-900 hover:bg-rose-950/60 border border-slate-700 hover:border-rose-500/40 px-3 py-2 text-xs font-semibold text-slate-300 hover:text-rose-300 transition disabled:opacity-50 inline-flex items-center gap-1.5 cursor-pointer ml-auto'
    );
    delBtn.type = 'button';
    delBtn.title = 'Xóa đơn xin nghỉ này khỏi danh sách';
    const icon = node('i', 'fa-solid fa-trash-can text-[11px]');
    delBtn.append(icon, document.createTextNode('Xóa đơn'));
    delBtn.addEventListener('click', () => void removeLeave(request, getActionsEl()));
    return delBtn;
  }

  function card(request, canReview, actor) {
    const admin = true;
    const isLate = (request.requestType || request.request_type) === 'late';
    const allowActions = canReview && request.profileId && Number.isSafeInteger(request.revision) && request.profileId !== actor;
    const card = node('article', 'rounded-xl border border-slate-700/70 bg-slate-950/50 p-3 space-y-2');
    const heading = node('div', 'flex items-start justify-between gap-3');
    const title = node('div', 'min-w-0');
    if (admin) title.append(node('p', 'font-semibold text-xs text-white break-words', `${request.userName} · ${request.userId}`));
    title.append(node('p', 'text-xs text-slate-300', `${request.date.split('-').reverse().join('/')} · Ca ${request.shift}`));
    const typeBadge = isLate
      ? node('span', 'inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-md bg-orange-500/15 text-orange-400 border border-orange-500/30', `⏰ Xin đi trễ (${request.lateMinutes || request.late_minutes || 15}p)`)
      : node('span', 'inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-400 border border-amber-500/30', '📝 Nghỉ phép');
    const badgeRow = node('div', 'flex items-center gap-1.5 mt-1');
    badgeRow.append(typeBadge);
    title.append(badgeRow);
    heading.append(title, node('span', `text-[11px] font-semibold shrink-0 ${colors[request.status] || 'text-slate-300'}`, labels[request.status] || request.status));
    card.append(heading, node('p', 'text-xs text-slate-300 whitespace-pre-wrap break-words', `Lý do: ${request.reason}`));
    if (request.reviewReason) card.append(node('p', 'text-[11px] text-slate-400 whitespace-pre-wrap break-words', `Phản hồi: ${request.reviewReason}`));
    if (request.reviewedAt) card.append(node('p', 'text-[10px] text-slate-500', `Xử lý bởi ${request.reviewedByName || request.reviewedBy} · ${new Date(request.reviewedAt).toLocaleString('vi-VN')}`));
    if (allowActions && request.status === 'pending') {
      const label = node('label', 'block text-[11px] text-slate-400', 'Ghi chú xét duyệt (bắt buộc khi từ chối)');
      const input = node('textarea', 'mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-teal-400');
      input.rows = 2;
      input.maxLength = 500;
      const draft = draftReasons.get(request.id);
      if (draft?.revision === request.revision) input.value = draft.value;
      else draftReasons.delete(request.id);
      input.addEventListener('input', () => {
        if (input.value) draftReasons.set(request.id,{revision:request.revision,value:input.value});
        else draftReasons.delete(request.id);
      });
      input.id = `leaveReviewReason_${request.id}`;
      label.htmlFor = input.id;
      const actions = node('div', 'flex items-center gap-2 flex-wrap');
      const approveText = isLate ? 'Chấp thuận (Miễn phạt trễ)' : 'Chấp thuận';
      const approve = node('button', 'rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50 cursor-pointer', approveText);
      const reject = node('button', 'rounded-lg bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/30 px-3 py-2 text-xs font-semibold text-rose-300 disabled:opacity-50 cursor-pointer', 'Từ chối');
      approve.type = reject.type = 'button';
      approve.addEventListener('click', () => review(request, 'approved', input, actions));
      reject.addEventListener('click', () => review(request, 'rejected', input, actions));
      actions.append(approve, reject, createDeleteButton(request, () => actions));
      card.append(label, input, actions);
    } else if (allowActions && request.status === 'approved') {
      const actions = node('div', 'flex items-center gap-2 flex-wrap pt-1');
      const revoke = node('button', 'rounded-lg bg-slate-800 hover:bg-rose-950/40 border border-slate-700 hover:border-rose-500/40 text-slate-300 hover:text-rose-300 px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 cursor-pointer', 'Hủy duyệt (Đưa về Chờ duyệt)');
      revoke.type = 'button';
      revoke.addEventListener('click', async () => {
        const revokePrompt = isLate
          ? 'Bạn có chắc muốn hủy duyệt đơn xin đi trễ này? Nếu sinh viên đã quét mã trễ, tiền phạt trễ sẽ được tính lại theo quy định.'
          : 'Bạn có chắc muốn hủy duyệt đơn này? Trạng thái điểm danh Vắng có phép sẽ bị hủy bỏ.';
        if (!confirm(revokePrompt)) return;
        await review(request, 'pending', { value: 'Hủy chấp thuận bởi Admin' }, actions);
      });
      actions.append(revoke, createDeleteButton(request, () => actions));
      card.append(actions);
    } else if (allowActions && request.status === 'rejected') {
      const actions = node('div', 'flex items-center gap-2 flex-wrap pt-1');
      const reApprove = node('button', 'rounded-lg bg-slate-800 hover:bg-emerald-950/40 border border-slate-700 hover:border-emerald-500/40 text-slate-300 hover:text-emerald-300 px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 cursor-pointer', 'Xét duyệt lại (Chấp thuận)');
      reApprove.type = 'button';
      reApprove.addEventListener('click', async () => {
        await review(request, 'approved', { value: 'Xét duyệt lại: Chấp thuận' }, actions);
      });
      actions.append(reApprove, createDeleteButton(request, () => actions));
      card.append(actions);
    } else if (allowActions && request.status === 'reviewing') {
      card.append(node('p', 'text-[11px] text-slate-400', request.needsRecovery
        ? 'Có gián đoạn khi ghi dữ liệu. Bấm đối chiếu để kiểm tra trạng thái đã lưu.'
        : 'Đơn đang được xử lý. Có thể đối chiếu nếu lượt xử lý gián đoạn quá 5 phút.'));
      const actions = node('div', 'flex items-center gap-2 flex-wrap pt-1');
      const reconcile = node('button', 'rounded-lg border border-blue-400/30 bg-blue-500/10 px-3 py-2 text-xs font-semibold text-blue-300 disabled:opacity-50 cursor-pointer', 'Đối chiếu trạng thái');
      reconcile.type = 'button';
      reconcile.addEventListener('click', () => toast('warning', 'Đơn cũ cần đối chiếu dữ liệu trước khi xử lý.'));
      actions.append(reconcile, createDeleteButton(request, () => actions));
      card.append(actions);
    } else if (canReview) {
      const actions = node('div', 'flex items-center gap-2 flex-wrap pt-1');
      actions.append(createDeleteButton(request, () => actions));
      card.append(actions);
    }
    return card;
  }

  async function load(reset = false) {
    if (!authenticated() || loading || deciding) return;
    if (reset) page = 1;
    loading = true; const version = ++generation;
    try {
      const filter = el('leaveRequestStatus').value || 'pending';
      const typeFilter = el('leaveRequestType')?.value || 'all';
      const response = await root.fetch(`/api/leaves?status=${encodeURIComponent(filter)}&type=${encodeURIComponent(typeFilter)}&page=${page}&limit=25`,
        { headers: root.getAdminHeaders(), cache: 'no-store', signal: AbortSignal.timeout(15000) });
      const result = await response.json();
      if (version !== generation || !authenticated()) return;
      if (!response.ok || result.success !== true || !Array.isArray(result.data)) throw new Error(result.message || 'Không tải được đơn nghỉ.');
      total = result.total;
      el('leaveRequestsList').replaceChildren();
      for (const request of result.data) el('leaveRequestsList').append(card(request, result.leaveEnabled === true && result.canReview === true, result.profileId));
      notice(result.leaveEnabled ? `${total} đơn theo bộ lọc. Ca đã chốt hoặc hết giờ không được duyệt nhưng có thể xóa.`
        : `${total} đơn theo bộ lọc. Xét duyệt đang chờ hoàn tất cập nhật.`);
      el('leaveRequestsPage').textContent = `Trang ${page}/${Math.max(1, Math.ceil(total / 25))}`;
      el('leaveRequestsPrev').disabled = page <= 1;
      el('leaveRequestsNext').disabled = page * 25 >= total;
    } catch (error) { if (version === generation) { el('leaveRequestsList').replaceChildren(); notice(error.message || 'Không tải được đơn nghỉ.'); } }
    finally { loading = false; }
  }

  async function removeLeave(request, actions) {
    if (deciding || !authenticated()) return;
    const isLate = (request.requestType || request.request_type) === 'late';
    const actionTypeName = isLate ? 'đơn xin đi trễ' : 'đơn xin nghỉ';
    const dateLabel = request.date ? request.date.split('-').reverse().join('/') : '';
    let confirmed = false;
    if (typeof root.showConfirmDialog === 'function') {
      confirmed = await root.showConfirmDialog({
        title: isLate ? 'Xóa Đơn Xin Đi Trễ' : 'Xóa Đơn Xin Nghỉ',
        message: `Bạn có chắc chắn muốn xóa ${actionTypeName} của <strong class="text-white">${request.userName} (${request.userId})</strong> — Ca ${request.shift} ngày ${dateLabel} khỏi hệ thống?`,
        confirmText: 'Xóa đơn',
        cancelText: 'Hủy',
        isDanger: true,
      });
    } else {
      confirmed = root.confirm(`Bạn có chắc chắn muốn xóa ${actionTypeName} của ${request.userName} (${request.userId}) - Ca ${request.shift} ngày ${dateLabel}?`);
    }
    if (!confirmed) return;

    deciding = true;
    const buttons = actions ? [...actions.querySelectorAll('button')] : [];
    const version = generation;
    buttons.forEach(button => { button.disabled = true; });
    try {
      const response = await root.fetch(`/api/leaves/${encodeURIComponent(request.id)}`, {
        method: 'DELETE',
        headers: root.getAdminHeaders(),
        signal: AbortSignal.timeout(20000),
      });
      const result = await response.json();
      if (version !== generation || !authenticated()) return;
      if (!response.ok || result.success !== true) throw new Error(result.message || `Chưa xóa được ${actionTypeName}.`);
      draftReasons.delete(request.id);
      toast('success', result.message || `Đã xóa ${actionTypeName} thành công.`);
      if (typeof root.fetchTodayAttendance === 'function') void root.fetchTodayAttendance();
      if (typeof root.fetchPersonalStats === 'function') void root.fetchPersonalStats();
      if (root.AdminTools?.loadAudit) void root.AdminTools.loadAudit();
    } catch (error) {
      toast('warning', error.message || `Chưa xóa được ${actionTypeName}. Vui lòng thử lại.`);
    } finally {
      deciding = false;
      buttons.forEach(button => { button.disabled = false; });
      await load();
    }
  }

  function notifyStudentLeaveDecision(request, decision, reviewReason) {
    try {
      const supabaseUrl = root.ATTENDANCE_CONFIG?.supabaseUrl;
      if (!supabaseUrl || !request?.userId) return;
      const isLate = (request.requestType || request.request_type) === 'late';
      const lateMins = request.lateMinutes || request.late_minutes || 15;
      const dateStr = request.date ? request.date.split('-').reverse().join('/') : '';
      let title = '';
      let body = '';

      if (decision === 'approved') {
        if (isLate) {
          const shiftStarts = { 'Sáng': [8, 0], 'Chiều': [13, 15], 'Tối': [18, 0] };
          const [sh, sm] = shiftStarts[request.shift] || [8, 0];
          const totalMins = sh * 60 + sm + Number(lateMins);
          const dh = String(Math.floor(totalMins / 60) % 24).padStart(2, '0');
          const dm = String(totalMins % 60).padStart(2, '0');
          title = '✅ Đơn xin đi trễ đã được DUYỆT';
          body = `Đơn xin trễ ${lateMins}p (Ca ${request.shift} - ${dateStr}) đã được duyệt. Hạn quét mã đúng giờ: trước ${dh}:${dm}.`;
        } else {
          title = '✅ Đơn xin nghỉ phép đã được DUYỆT';
          body = `Đơn xin nghỉ phép Ca ${request.shift} ngày ${dateStr} của bạn đã được Admin chấp thuận.`;
        }
      } else if (decision === 'rejected') {
        title = isLate ? '❌ Đơn xin đi trễ bị TỪ CHỐI' : '❌ Đơn xin nghỉ phép bị TỪ CHỐI';
        body = `Đơn Ca ${request.shift} (${dateStr}) không được duyệt.${reviewReason ? ' Lý do: ' + reviewReason : ''} Vui lòng có mặt đúng giờ quy định.`;
      } else if (decision === 'pending') {
        title = '⚠️ Đơn xin phép đã hủy duyệt';
        body = `Đơn Ca ${request.shift} (${dateStr}) đã chuyển về trạng thái Chờ duyệt.${reviewReason ? ' Ghi chú: ' + reviewReason : ''}`;
      } else {
        return;
      }

      void root.fetch(`${supabaseUrl}/functions/v1/web-push-worker`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'send_to_user',
          student_id: request.userId,
          type: decision === 'approved' ? 'leave_approved' : 'leave_rejected',
          title,
          body,
          data: { url: './checkin.html', leaveId: request.id, shift: request.shift, date: request.date }
        })
      }).catch(() => {});
    } catch (e) {}
  }

  async function review(request, decision, input, actions) {
    if (deciding || !authenticated()) return;
    const reason = input.value.trim();
    if (['pending','rejected'].includes(decision) && !reason) { toast('warning', 'Cần nhập lý do khi từ chối hoặc hủy duyệt.'); input.focus?.(); return; }
    deciding = true; const buttons = [...actions.querySelectorAll('button')];
    const version = generation;
    buttons.forEach(button => { button.disabled = true; }); input.disabled = true;
    try {
      const response = await root.fetch(`/api/leaves/${encodeURIComponent(request.id)}/review`, { method: 'POST', headers: root.getAdminHeaders(),
        body: JSON.stringify({ decision, reason, expectedRevision: request.revision }), signal: AbortSignal.timeout(20000) });
      const result = await response.json();
      if (version !== generation || !authenticated()) return;
      if (!response.ok || result.success !== true) throw new Error(result.message || 'Chưa nhận được kết quả. Tải lại danh sách trước khi thử lại.');
      draftReasons.delete(request.id);
      toast('success', result.message);
      notifyStudentLeaveDecision(request, decision, reason);
      if (typeof root.fetchTodayAttendance === 'function') void root.fetchTodayAttendance();
      if (typeof root.fetchPersonalStats === 'function') void root.fetchPersonalStats();
      if (root.AdminTools?.loadAudit) void root.AdminTools.loadAudit();
    } catch (error) { toast('warning', error.message || 'Chưa nhận được phản hồi. Đối chiếu danh sách trước khi thử lại.'); }
    finally {
      deciding = false; input.disabled = false; buttons.forEach(button => { button.disabled = false; });
      await load();
    }
  }
  el('btnRefreshLeaveRequests')?.addEventListener('click', () => void load());
  el('leaveRequestStatus')?.addEventListener('change', () => void load(true));
  el('leaveRequestType')?.addEventListener('change', () => void load(true));
  el('leaveRequestsPrev').addEventListener('click', () => { if (!loading && page > 1) { page--; void load(); } });
  el('leaveRequestsNext').addEventListener('click', () => { if (!loading && page * 25 < total) { page++; void load(); } });
  document.addEventListener('admin-auth-changed', event => {
    generation++; draftReasons.clear();
    if (event.detail.authenticated) void load(true);
    else { el('leaveRequestsList').replaceChildren(); notice('Đăng nhập Admin để xem đơn nghỉ.'); }
  });
  setInterval(() => { if (!root.AdminLiveRefresh && !document.hidden && !section.contains(document.activeElement)) void load(); }, 30000);
  root.LeaveRequestsUI = Object.freeze({ loadAdmin: load, isBusy: () => loading || deciding });
  void load();
})(globalThis);
