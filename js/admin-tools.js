(() => {
  'use strict';
  const list = document.getElementById('auditLogList');
  if (!list) return;
  const notice = document.getElementById('auditNotice');
  const labels = {
    'admin.login': 'Đăng nhập', 'admin.logout': 'Đăng xuất', 'admin.password-change': 'Đổi mật khẩu',
    'admin.grant': 'Cấp quyền Admin', 'admin.revoke': 'Thu hồi quyền Admin',
    'user.create': 'Thêm sinh viên', 'user.delete': 'Xóa sinh viên', 'user.device.reset': 'Mở khóa thiết bị',
    'attendance.update': 'Sửa điểm danh', 'attendance.clear': 'Đặt lại điểm danh',
    'attendance.cancel': 'Hủy lượt quét', 'attendance.reset': 'Reset ngày', 'attendance.reset-all': 'Reset toàn bộ',
    'schedule.update': 'Cập nhật lịch tuần', 'leave.approved': 'Chấp thuận nghỉ', 'leave.rejected': 'Từ chối nghỉ',
    'leave.submitted': 'Gửi đơn nghỉ', 'leave.reconciled': 'Đối chiếu đơn gián đoạn',
    'schedule.sync.start': 'Bắt đầu đồng bộ', 'schedule.sync.complete': 'Hoàn tất đồng bộ',
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
      card.className = 'p-3 rounded-xl border border-slate-800 bg-slate-950/50 space-y-2';
      card.append(text('p', `${labels[event.action] || event.action} · ${event.targetId || 'Hệ thống'}`, 'text-xs font-semibold text-slate-100'));
      const time = new Date(event.createdAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
      card.append(text('p', `${time} · Người thực hiện: ${event.actorId}`, 'text-[11px] text-slate-400'));
      if (event.reason) card.append(text('p', `Lý do: ${event.reason}`, 'text-xs text-slate-300 break-words'));
      if (event.before || event.after || event.metadata) {
        const details = document.createElement('details');
        details.className = 'text-[11px] text-slate-400';
        details.append(text('summary', 'Xem dữ liệu trước và sau', 'cursor-pointer py-1'));
        const pre = text('pre', JSON.stringify({ before: event.before, after: event.after, metadata: event.metadata }, null, 2),
          'mt-2 whitespace-pre-wrap break-words max-h-72 overflow-auto rounded-lg bg-slate-900 p-3 text-slate-300');
        details.append(pre);
        card.append(details);
      }
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
