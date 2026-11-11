(() => {
  'use strict';
  const list = document.getElementById('auditLogList');
  if (!list) return;
  const notice = document.getElementById('auditNotice');
  const actionMeta = {
    'attendance.adjusted': { label: 'Điều chỉnh điểm danh', color: 'bg-blue-500/15 text-blue-300 border-blue-500/30', icon: 'fa-user-pen' },
    'attendance.scan': { label: 'Quét mã điểm danh', color: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', icon: 'fa-qrcode' },
    'device.bind': { label: 'Khóa máy thiết bị', color: 'bg-purple-500/15 text-purple-300 border-purple-500/30', icon: 'fa-mobile-screen-button' },
    'device.reset': { label: 'Mở khóa thiết bị', color: 'bg-amber-500/15 text-amber-300 border-amber-500/30', icon: 'fa-lock-open' },
    'user.device.reset': { label: 'Mở khóa thiết bị', color: 'bg-amber-500/15 text-amber-300 border-amber-500/30', icon: 'fa-lock-open' },
    'leave.reviewed': { label: 'Xét duyệt đơn nghỉ', color: 'bg-teal-500/15 text-teal-300 border-teal-500/30', icon: 'fa-file-signature' },
    'leave.approved': { label: 'Chấp thuận đơn nghỉ', color: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', icon: 'fa-check' },
    'leave.rejected': { label: 'Từ chối đơn nghỉ', color: 'bg-rose-500/15 text-rose-300 border-rose-500/30', icon: 'fa-xmark' },
    'leave.submitted': { label: 'Gửi đơn nghỉ', color: 'bg-amber-500/15 text-amber-300 border-amber-500/30', icon: 'fa-envelope-open' },
    'leave.deleted': { label: 'Xóa đơn nghỉ', color: 'bg-rose-500/15 text-rose-300 border-rose-500/30', icon: 'fa-trash' },
    'session.closed': { label: 'Chốt ca điểm danh', color: 'bg-slate-700/40 text-slate-300 border-slate-600/40', icon: 'fa-calendar-check' },
    'attendance.update': { label: 'Sửa điểm danh', color: 'bg-blue-500/15 text-blue-300 border-blue-500/30', icon: 'fa-pen-to-square' },
    'attendance.clear': { label: 'Đặt lại điểm danh', color: 'bg-slate-700/40 text-slate-300 border-slate-600/40', icon: 'fa-rotate-left' },
    'attendance.cancel': { label: 'Hủy lượt quét', color: 'bg-rose-500/15 text-rose-300 border-rose-500/30', icon: 'fa-ban' },
    'attendance.reset': { label: 'Reset ngày', color: 'bg-rose-500/15 text-rose-300 border-rose-500/30', icon: 'fa-arrows-rotate' },
    'attendance.reset-all': { label: 'Reset toàn bộ', color: 'bg-rose-500/20 text-rose-300 border-rose-500/40', icon: 'fa-triangle-exclamation' },
    'schedule.update': { label: 'Cập nhật lịch tuần', color: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30', icon: 'fa-calendar-days' },
    'schedule.saved': { label: 'Lưu lịch tuần', color: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30', icon: 'fa-calendar-days' },
    'admin.login': { label: 'Đăng nhập Admin', color: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', icon: 'fa-right-to-bracket' },
    'admin.logout': { label: 'Đăng xuất Admin', color: 'bg-slate-700/40 text-slate-300 border-slate-600/40', icon: 'fa-right-from-bracket' },
    'admin.password-change': { label: 'Đổi mật khẩu', color: 'bg-amber-500/15 text-amber-300 border-amber-500/30', icon: 'fa-key' },
    'admin.grant': { label: 'Cấp quyền Admin', color: 'bg-amber-500/15 text-amber-300 border-amber-500/30', icon: 'fa-shield-halved' },
    'admin.revoke': { label: 'Thu hồi quyền Admin', color: 'bg-rose-500/15 text-rose-300 border-rose-500/30', icon: 'fa-shield' },
    'user.create': { label: 'Thêm sinh viên', color: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', icon: 'fa-user-plus' },
    'user.delete': { label: 'Xóa sinh viên', color: 'bg-rose-500/15 text-rose-300 border-rose-500/30', icon: 'fa-user-minus' },
  };
  let page = 1;
  let pages = 1;
  let requestId = 0;
  let filters = new URLSearchParams();

  function text(tag, value, className = '') {
    const node = document.createElement(tag);
    node.textContent = value;
    node.className = className;
    return node;
  }

  function render(events) {
    list.replaceChildren();
    for (const event of events) {
      const card = document.createElement('article');
      card.className = 'p-3 rounded-xl border border-slate-800 bg-slate-950/50 space-y-1.5 transition-all hover:border-slate-700';
      const meta = actionMeta[event.action] || { label: event.action, color: 'bg-slate-800 text-slate-300 border-slate-700', icon: 'fa-clock-rotate-left' };

      const headerDiv = document.createElement('div');
      headerDiv.className = 'flex flex-wrap items-center gap-2';

      const badge = document.createElement('span');
      badge.className = `inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-bold border ${meta.color}`;
      badge.innerHTML = `<i class="fa-solid ${meta.icon} text-[9px]"></i> ${meta.label}`;
      headerDiv.append(badge);

      if (event.targetId && event.targetId !== 'Hệ thống') {
        const targetSpan = document.createElement('span');
        targetSpan.className = 'text-xs font-semibold text-white';
        targetSpan.textContent = event.targetId;
        headerDiv.append(targetSpan);
      }

      card.append(headerDiv);

      const time = new Date(event.createdAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
      card.append(text('p', `${time} · Người thực hiện: ${event.actorId}`, 'text-[11px] text-slate-400'));
      if (event.reason) card.append(text('p', `Lý do: ${event.reason}`, 'text-xs text-slate-300 break-words'));
      list.append(card);
    }
  }

  async function loadAudit(event) {
    event?.preventDefault();
    if (!window.AdminAuth?.isAuthenticated()) return;
    if (event) {
      page = 1;
      filters = new URLSearchParams();
      for (const [key, id] of [['targetId', 'auditTarget'], ['actorId', 'auditActor'], ['from', 'auditFrom'], ['to', 'auditTo']]) {
        const value = document.getElementById(id).value.trim();
        if (value) filters.set(key, value);
      }
    }
    const current = ++requestId;
    notice.textContent = 'Đang tải nhật ký...';
    const button = document.getElementById('btnFilterAudit');
    button.disabled = true;
    try {
      const query = new URLSearchParams(filters);
      query.set('page', String(page));
      const response = await fetch(`/api/admin/audit-logs?${query}`, {
        headers: getAdminHeaders(), cache: 'no-store', signal: AbortSignal.timeout(15000),
      });
      if (current !== requestId) return;
      if (response.status === 401 || response.status === 403) { AdminAuth.expire(); return; }
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.message || 'Không tải được nhật ký.');
      if (current !== requestId) return;
      pages = body.pages;
      render(body.data);
      notice.textContent = body.total ? `${body.total} thao tác phù hợp.` : 'Chưa có thao tác phù hợp với bộ lọc.';
      document.getElementById('auditPageLabel').textContent = `Trang ${page}/${pages}`;
      document.getElementById('auditPrev').disabled = page <= 1;
      document.getElementById('auditNext').disabled = page >= pages;
    } catch (error) {
      if (current === requestId) notice.textContent = error.message || 'Không kết nối được máy chủ.';
    } finally {
      if (current === requestId) button.disabled = false;
    }
  }

  function refresh() {
    loadAudit();
    window.LeaveRequestsUI?.loadAdmin();
  }
  document.addEventListener('admin-auth-changed', event => {
    requestId += 1;
    if (event.detail.authenticated) {
      updateDynamicQR();
      if (!document.getElementById('tab-admin-tools').classList.contains('hidden')) loadAudit();
    } else {
      list.replaceChildren();
      notice.textContent = '';
      document.getElementById('qrcodeCanvas').replaceChildren();
    }
  });
  window.AdminTools = { refresh, loadAudit, auditPage(delta) {
    const next = Math.min(pages, Math.max(1, page + delta));
    if (next !== page) { page = next; loadAudit(); }
  } };
})();
