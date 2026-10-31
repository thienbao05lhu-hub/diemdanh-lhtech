// Luồng đơn nghỉ: sinh viên gửi và xem trạng thái; Admin xét duyệt.
(() => {
  'use strict';

  const adminSection = document.getElementById('leaveRequestsSection');
  const studentSection = document.getElementById('myLeaveRequestsSection');
  const labels = { pending: 'Chờ duyệt', reviewing: 'Đang xử lý', approved: 'Đã chấp thuận', rejected: 'Đã từ chối' };
  const colors = { approved: 'text-emerald-300', rejected: 'text-rose-300', pending: 'text-amber-300', reviewing: 'text-blue-300' };
  let adminPage = 1;
  let adminTotal = 0;
  let adminRevision = 0;

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = String(text);
    return element;
  }

  function notify(type, message) {
    if (typeof window.showToast?.[type] === 'function') window.showToast[type](message);
  }

  function notice(id, message, error = false) {
    const target = document.getElementById(id);
    if (!target) return;
    target.textContent = message;
    target.className = `text-xs ${error ? 'text-amber-300' : 'text-slate-400'}`;
  }

  function authenticated() {
    return Boolean(window.AdminAuth?.isAuthenticated());
  }

  function cardFor(request, admin = false) {
    const card = node('article', 'rounded-xl border border-slate-700/70 bg-slate-950/50 p-3 space-y-2');
    const heading = node('div', 'flex items-start justify-between gap-3');
    const title = node('div', 'min-w-0');
    if (admin) title.append(node('p', 'font-semibold text-xs text-white break-words', `${request.userName} · ${request.userId}`));
    title.append(node('p', 'text-xs text-slate-300', `${request.date.split('-').reverse().join('/')} · Ca ${request.shift}`));
    heading.append(title, node('span', `text-[11px] font-semibold shrink-0 ${colors[request.status] || 'text-slate-300'}`, labels[request.status] || request.status));
    card.append(heading, node('p', 'text-xs text-slate-300 whitespace-pre-wrap break-words', `Lý do: ${request.reason}`));
    if (request.reviewReason) card.append(node('p', 'text-[11px] text-slate-400 whitespace-pre-wrap break-words', `Phản hồi: ${request.reviewReason}`));
    if (request.reviewedAt) card.append(node('p', 'text-[10px] text-slate-500', `Xử lý bởi ${request.reviewedByName || request.reviewedBy} · ${new Date(request.reviewedAt).toLocaleString('vi-VN')}`));
    if (admin && request.status === 'pending') {
      const label = node('label', 'block text-[11px] text-slate-400', 'Ghi chú xét duyệt (bắt buộc khi từ chối)');
      const input = node('textarea', 'mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-teal-400');
      input.rows = 2;
      input.maxLength = 500;
      input.id = `leaveReviewReason_${request.id}`;
      label.htmlFor = input.id;
      const actions = node('div', 'flex gap-2 flex-wrap');
      const approve = node('button', 'rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50', 'Chấp thuận');
      const reject = node('button', 'rounded-lg bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/30 px-3 py-2 text-xs font-semibold text-rose-300 disabled:opacity-50', 'Từ chối');
      approve.type = reject.type = 'button';
      approve.addEventListener('click', () => review(request.id, 'approved', input, actions));
      reject.addEventListener('click', () => review(request.id, 'rejected', input, actions));
      actions.append(approve, reject);
      card.append(label, input, actions);
    } else if (admin && request.status === 'reviewing') {
      card.append(node('p', 'text-[11px] text-slate-400', request.needsRecovery
        ? 'Có gián đoạn khi ghi dữ liệu. Bấm đối chiếu để kiểm tra trạng thái đã lưu.'
        : 'Đơn đang được xử lý. Có thể đối chiếu nếu lượt xử lý gián đoạn quá 5 phút.'));
      const reconcile = node('button', 'rounded-lg border border-blue-400/30 bg-blue-500/10 px-3 py-2 text-xs font-semibold text-blue-300 disabled:opacity-50', 'Đối chiếu trạng thái');
      reconcile.type = 'button';
      reconcile.addEventListener('click', () => reconcileRequest(request.id, reconcile));
      card.append(reconcile);
    }
    return card;
  }

  function requireLogin() {
    notify('warning', 'Phiên Admin đã hết hạn. Vui lòng đăng nhập lại.');
    if (typeof window.AdminAuth?.expire === 'function') window.AdminAuth.expire();
    else if (typeof window.showAdminOverlay === 'function') window.showAdminOverlay();
  }

  async function loadAdmin(resetPage = false) {
    if (!adminSection || !authenticated()) return;
    if (resetPage) adminPage = 1;
    const revision = ++adminRevision;
    const filter = document.getElementById('leaveRequestStatus')?.value || 'pending';
    try {
      const response = await fetch(`/api/leaves?status=${encodeURIComponent(filter)}&page=${adminPage}&limit=25`, {
        headers: getAdminHeaders(), cache: 'no-store', signal: AbortSignal.timeout(15000),
      });
      if (revision !== adminRevision || !authenticated()) return;
      if ([401, 403].includes(response.status)) { requireLogin(); return; }
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || 'Không tải được đơn nghỉ.');
      const list = document.getElementById('leaveRequestsList');
      if (!list) return;
      list.replaceChildren();
      result.data.forEach(request => list.append(cardFor(request, true)));
      adminTotal = result.total;
      notice('leaveRequestsNotice', result.data.length ? `${adminTotal} đơn theo bộ lọc.` : 'Không có đơn xin nghỉ theo bộ lọc này.');
      const pageText = document.getElementById('leaveRequestsPage');
      if (pageText) pageText.textContent = `Trang ${adminPage}/${Math.max(1, Math.ceil(adminTotal / 25))}`;
      const previous = document.getElementById('leaveRequestsPrev');
      const next = document.getElementById('leaveRequestsNext');
      if (previous) previous.disabled = adminPage <= 1;
      if (next) next.disabled = adminPage * 25 >= adminTotal;
    } catch (error) {
      if (revision === adminRevision) notice('leaveRequestsNotice', error.message || 'Lỗi kết nối khi tải đơn nghỉ.', true);
    }
  }

  async function review(id, decision, input, actions) {
    const reason = input.value.trim();
    if (decision === 'rejected' && !reason) {
      notify('warning', 'Vui lòng nhập lý do từ chối đơn.');
      input.focus();
      return;
    }
    const buttons = [...actions.querySelectorAll('button')];
    buttons.forEach(button => { button.disabled = true; });
    input.disabled = true;
    try {
      const response = await fetch(`/api/leaves/${encodeURIComponent(id)}/review`, {
        method: 'POST', headers: getAdminHeaders(), body: JSON.stringify({ decision, reason }), signal: AbortSignal.timeout(20000),
      });
      if ([401, 403].includes(response.status)) { requireLogin(); return; }
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || 'Không xử lý được đơn nghỉ.');
      notify('success', result.message);
      await loadAdmin();
      if (typeof window.fetchTodayAttendance === 'function') window.fetchTodayAttendance();
      if (typeof window.fetchPersonalStats === 'function') window.fetchPersonalStats();
    } catch (error) {
      notify('warning', error.message || 'Chưa nhận được phản hồi. Hãy làm mới danh sách để kiểm tra trước khi thử lại.');
      await loadAdmin();
    } finally {
      buttons.forEach(button => { button.disabled = false; });
      input.disabled = false;
    }
  }

  async function reconcileRequest(id, button) {
    button.disabled = true;
    try {
      const response = await fetch(`/api/leaves/${encodeURIComponent(id)}/reconcile`, {
        method: 'POST', headers: getAdminHeaders(), signal: AbortSignal.timeout(20000),
      });
      if ([401, 403].includes(response.status)) { requireLogin(); return; }
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || 'Không đối chiếu được đơn nghỉ.');
      notify('success', result.message);
      await loadAdmin();
      if (typeof window.fetchTodayAttendance === 'function') window.fetchTodayAttendance();
    } catch (error) {
      notify('warning', error.message);
    } finally {
      button.disabled = false;
    }
  }

  async function loadMine() {
    if (!studentSection) return;
    const userId = localStorage.getItem('qr_user_id');
    const deviceId = localStorage.getItem('qr_device_id');
    if (!userId || !deviceId) return;
    try {
      const response = await fetch('/api/leaves/mine', {
        headers: { 'x-student-user': userId, 'x-student-device': deviceId }, cache: 'no-store', signal: AbortSignal.timeout(15000),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || 'Không tải được trạng thái đơn nghỉ.');
      const list = document.getElementById('myLeaveRequestsList');
      if (!list) return;
      list.replaceChildren();
      result.data.forEach(request => list.append(cardFor(request)));
      notice('myLeaveRequestsNotice', result.data.length ? 'Các đơn gần đây của bạn. Chỉ đơn được chấp thuận mới tính nghỉ có phép.' : 'Bạn chưa có đơn xin nghỉ.');
    } catch (error) {
      notice('myLeaveRequestsNotice', error.message || 'Lỗi kết nối khi xem đơn nghỉ.', true);
    }
  }

  function vietnamDate(offsetDays = 0) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date()).map(part => [part.type, part.value]));
    const value = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00.000Z`);
    value.setUTCDate(value.getUTCDate() + offsetDays);
    return value.toISOString().slice(0, 10);
  }

  if (studentSection) {
    const originalOpen = window.openLeaveModal;
    if (typeof originalOpen === 'function') window.openLeaveModal = function () {
      originalOpen();
      const input = document.getElementById('leaveDate');
      if (input) {
        input.min = vietnamDate(); input.max = vietnamDate(30); input.value = vietnamDate();
      }
    };
    window.handleSendLeaveRequest = async event => {
      event.preventDefault();
      const button = document.getElementById('btnConfirmLeave');
      if (button?.disabled) return;
      const userId = localStorage.getItem('qr_user_id');
      const deviceId = localStorage.getItem('qr_device_id');
      const shift = document.getElementById('leaveShift')?.value;
      const date = document.getElementById('leaveDate')?.value || vietnamDate();
      const reason = document.getElementById('leaveReason')?.value.trim() || '';
      if (!userId || !deviceId || !reason) { notify('warning', 'Vui lòng kích hoạt thiết bị và nhập lý do xin nghỉ.'); return; }
      const original = button?.innerHTML;
      if (button) { button.disabled = true; button.textContent = 'Đang gửi đơn...'; }
      try {
        const response = await fetch('/api/leaves', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, deviceId, date, shift, reason }), signal: AbortSignal.timeout(20000),
        });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.message || 'Không gửi được đơn nghỉ.');
        window.closeLeaveModal();
        const message = result.alreadySubmitted
          ? `Ca ${shift}: ${labels[result.data.status] || result.data.status}.`
          : `Ca ${shift}: Đơn đang chờ quản trị viên duyệt.`;
        if (typeof window.showScanResult === 'function') window.showScanResult(true, 'Đã gửi đơn xin nghỉ', message);
        notify('success', result.message);
        await loadMine();
      } catch (error) {
        notify('warning', error.message || 'Chưa nhận được phản hồi. Hãy kiểm tra danh sách đơn trước khi gửi lại.');
        await loadMine();
      } finally {
        if (button) { button.disabled = false; button.innerHTML = original; }
      }
    };
    const originalCheck = window.checkAuthState;
    if (typeof originalCheck === 'function') window.checkAuthState = function (...args) {
      const result = originalCheck(...args);
      loadMine();
      return result;
    };
    const originalRegister = window.handleRegisterDevice;
    if (typeof originalRegister === 'function') window.handleRegisterDevice = async function (...args) {
      const result = await originalRegister(...args);
      loadMine();
      return result;
    };
    document.getElementById('btnRefreshMyLeaves')?.addEventListener('click', loadMine);
    loadMine();
  }

  if (adminSection) {
    document.getElementById('btnRefreshLeaveRequests')?.addEventListener('click', () => loadAdmin());
    document.getElementById('leaveRequestStatus')?.addEventListener('change', () => loadAdmin(true));
    document.getElementById('leaveRequestsPrev')?.addEventListener('click', () => { if (adminPage > 1) { adminPage -= 1; loadAdmin(); } });
    document.getElementById('leaveRequestsNext')?.addEventListener('click', () => { if (adminPage * 25 < adminTotal) { adminPage += 1; loadAdmin(); } });
    document.addEventListener('admin-auth-changed', event => {
      adminRevision += 1;
      if (event.detail.authenticated) loadAdmin(true);
      else {
        document.getElementById('leaveRequestsList')?.replaceChildren();
        notice('leaveRequestsNotice', 'Đăng nhập Admin để xem và duyệt đơn nghỉ.');
      }
    });
    loadAdmin();
  }
  setInterval(() => {
    if (document.hidden) return;
    if (adminSection && !adminSection.contains(document.activeElement)) loadAdmin();
    if (studentSection) loadMine();
  }, 30000);
  window.LeaveRequestsUI = { loadAdmin, loadMine };
})();
