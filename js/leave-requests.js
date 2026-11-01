/* Admin xét duyệt đơn bằng Auth + revision CAS. Không dùng MSSV/reviewer do client tự khai. */
(function (root) {
  'use strict';
  const section = document.getElementById('leaveRequestsSection');
  if (!section) return;
  const el = id => document.getElementById(id);
  const labels = { pending: 'Chờ duyệt', reviewing: 'Cần đối chiếu', approved: 'Đã chấp thuận', rejected: 'Đã từ chối' };
  let page = 1, total = 0, generation = 0, loading = false, deciding = false;
  const authenticated = () => Boolean(root.AdminAuth?.isAuthenticated());
  function node(tag, text, className = '') {
    const item = document.createElement(tag); item.textContent = text; item.className = className; return item;
  }
  function notice(text) { el('leaveRequestsNotice').textContent = text; }
  function toast(type, text) { root.showToast?.[type]?.(text); notice(text); }
  function card(request, canReview, actor) {
    const item = node('article', '', 'rounded-xl border border-slate-700 bg-slate-950/50 p-4 space-y-2 text-xs text-slate-300');
    item.append(node('p', `${request.userName || 'Chưa có tên'} · ${request.userId}`, 'font-semibold text-white'));
    item.append(node('p', `${request.date} · Ca ${request.shift} · ${labels[request.status] || request.status}`));
    item.append(node('p', `Lý do: ${request.reason || '—'}`, 'whitespace-pre-wrap break-words'));
    if (request.reviewReason) item.append(node('p', `Phản hồi: ${request.reviewReason}`, 'whitespace-pre-wrap break-words'));
    if (request.reviewedAt) item.append(node('p', `Xử lý bởi ${request.reviewedByName || request.reviewedBy || '—'} · ${new Date(request.reviewedAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`));
    if (request.status === 'reviewing' || !request.profileId || !Number.isSafeInteger(request.revision)) {
      item.append(node('p', 'Đơn cũ cần đối chiếu trước khi xử lý. Không tự đổi trạng thái.')); return item;
    }
    if (!canReview || actor === request.profileId) {
      if (actor === request.profileId) item.append(node('p', 'Bạn không được tự duyệt đơn của mình.'));
      return item;
    }
    const label = node('label', 'Ghi chú (bắt buộc khi từ chối hoặc hủy duyệt)');
    const input = node('textarea', '', 'w-full rounded-lg border border-slate-700 bg-slate-900 p-2 text-white');
    input.id = `leave-reason-${request.id}`; input.maxLength = 500; input.rows = 2; label.htmlFor = input.id;
    const actions = node('div', '', 'flex flex-wrap gap-2');
    const choices = request.status === 'pending' ? [['approved','Chấp thuận'],['rejected','Từ chối']]
      : request.status === 'approved' ? [['pending','Hủy duyệt']]
      : request.status === 'rejected' ? [['approved','Xét lại: chấp thuận']] : [];
    for (const [decision, text] of choices) {
      const button = node('button', text, 'rounded-lg border border-teal-600 px-3 py-2 disabled:opacity-50'); button.type = 'button';
      button.addEventListener('click', () => void review(request, decision, input, actions)); actions.append(button);
    }
    if (choices.length) item.append(label, input, actions);
    return item;
  }
  async function load(reset = false) {
    if (!authenticated() || loading || deciding) return;
    if (reset) page = 1;
    loading = true; const version = ++generation;
    try {
      const filter = el('leaveRequestStatus').value || 'pending';
      const response = await root.fetch(`/api/leaves?status=${encodeURIComponent(filter)}&page=${page}&limit=25`,
        { headers: root.getAdminHeaders(), cache: 'no-store', signal: AbortSignal.timeout(15000) });
      const result = await response.json();
      if (version !== generation || !authenticated()) return;
      if (!response.ok || result.success !== true || !Array.isArray(result.data)) throw new Error(result.message || 'Không tải được đơn nghỉ.');
      total = result.total;
      el('leaveRequestsList').replaceChildren();
      for (const request of result.data) el('leaveRequestsList').append(card(request, result.leaveEnabled === true && result.canReview === true, result.profileId));
      notice(result.leaveEnabled ? `${total} đơn theo bộ lọc. Ca đã chốt hoặc hết giờ không được thay đổi.`
        : `${total} đơn theo bộ lọc. Xét duyệt đang chờ hoàn tất cập nhật.`);
      el('leaveRequestsPage').textContent = `Trang ${page}/${Math.max(1, Math.ceil(total / 25))}`;
      el('leaveRequestsPrev').disabled = page <= 1;
      el('leaveRequestsNext').disabled = page * 25 >= total;
    } catch (error) { if (version === generation) { el('leaveRequestsList').replaceChildren(); notice(error.message || 'Không tải được đơn nghỉ.'); } }
    finally { loading = false; }
  }
  async function review(request, decision, input, actions) {
    if (deciding || !authenticated()) return;
    const reason = input.value.trim();
    if (['pending','rejected'].includes(decision) && !reason) { toast('warning', 'Cần nhập lý do khi từ chối hoặc hủy duyệt.'); input.focus(); return; }
    if (decision === 'pending' && !root.confirm('Hủy duyệt đơn này? Hệ thống sẽ đối chiếu trước khi hoàn tác bản ghi nghỉ có phép.')) return;
    deciding = true; const buttons = [...actions.querySelectorAll('button')];
    const version = generation;
    buttons.forEach(button => { button.disabled = true; }); input.disabled = true;
    try {
      const response = await root.fetch(`/api/leaves/${encodeURIComponent(request.id)}/review`, { method: 'POST', headers: root.getAdminHeaders(),
        body: JSON.stringify({ decision, reason, expectedRevision: request.revision }), signal: AbortSignal.timeout(20000) });
      const result = await response.json();
      if (version !== generation || !authenticated()) return;
      if (!response.ok || result.success !== true) throw new Error(result.message || 'Chưa nhận được kết quả. Tải lại danh sách trước khi thử lại.');
      toast('success', result.message);
      if (typeof root.fetchTodayAttendance === 'function') void root.fetchTodayAttendance();
      if (typeof root.fetchPersonalStats === 'function') void root.fetchPersonalStats();
    } catch (error) { toast('warning', error.message || 'Chưa nhận được phản hồi. Đối chiếu danh sách trước khi thử lại.'); }
    finally {
      deciding = false; input.disabled = false; buttons.forEach(button => { button.disabled = false; });
      await load();
    }
  }
  el('btnRefreshLeaveRequests')?.addEventListener('click', () => void load());
  el('leaveRequestStatus').addEventListener('change', () => void load(true));
  el('leaveRequestsPrev').addEventListener('click', () => { if (!loading && page > 1) { page--; void load(); } });
  el('leaveRequestsNext').addEventListener('click', () => { if (!loading && page * 25 < total) { page++; void load(); } });
  document.addEventListener('admin-auth-changed', event => {
    generation++;
    if (event.detail.authenticated) void load(true);
    else { el('leaveRequestsList').replaceChildren(); notice('Đăng nhập Admin để xem đơn nghỉ.'); }
  });
  setInterval(() => { if (!document.hidden && !section.contains(document.activeElement)) void load(); }, 30000);
  root.LeaveRequestsUI = Object.freeze({ loadAdmin: load });
  void load();
})(globalThis);
