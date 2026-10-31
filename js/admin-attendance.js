/**
 * Quản trị Điểm danh Thời gian thực: Quản lý QR Động 30s, Khóa thiết bị & Bảng điểm danh 3 ca
 */
(function (root) {
  'use strict';

  const api = root.Attendance;
  if (!api) return;

  let activeShift = 'Sáng';
  let qrTimer = null;
  let pollTimer = null;
  let remainingSeconds = 30;
  let qrcodeInstance = null;
  let fullscreenQrInstance = null;
  let currentToken = '';

  function detectShift() {
    const now = new Date();
    // Chuyển sang giờ Việt Nam (UTC+7)
    const vnTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
    const hours = vnTime.getHours();
    const minutes = vnTime.getMinutes();
    const totalMinutes = hours * 60 + minutes;

    if (totalMinutes < 720) return 'Sáng';    // Trước 12:00
    if (totalMinutes < 1050) return 'Chiều';  // 12:00 - 17:30
    return 'Tối';                             // Sau 17:30
  }

  function getTodayIso() {
    const now = new Date();
    const vnTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
    const y = vnTime.getFullYear();
    const m = String(vnTime.getMonth() + 1).padStart(2, '0');
    const d = String(vnTime.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  async function refreshQrToken() {
    try {
      const res = await api.client.rpc('admin_get_active_qr');
      if (res.error) {
        console.error('Lỗi lấy mã QR:', res.error);
        return;
      }
      const data = res.data;
      if (!data || !data.token) return;

      currentToken = data.token;
      remainingSeconds = data.expiresIn || 30;

      renderQrCode(data.token);
      updateTimerDisplay();
    } catch (e) {
      console.error('Ngoại lệ khi lấy QR:', e);
    }
  }

  function renderQrCode(text) {
    const container = document.getElementById('qrcode');
    if (!container) return;
    container.innerHTML = '';
    qrcodeInstance = new root.QRCode(container, {
      text: text,
      width: 200,
      height: 200,
      colorDark: '#14253e',
      colorLight: '#ffffff',
      correctLevel: root.QRCode.CorrectLevel.M,
    });

    const fsContainer = document.getElementById('fullscreen-qrcode');
    if (fsContainer) {
      fsContainer.innerHTML = '';
      fullscreenQrInstance = new root.QRCode(fsContainer, {
        text: text,
        width: 320,
        height: 320,
        colorDark: '#14253e',
        colorLight: '#ffffff',
        correctLevel: root.QRCode.CorrectLevel.H,
      });
    }
  }

  function updateTimerDisplay() {
    const timerText = document.getElementById('qr-timer-text');
    const timerBar = document.getElementById('qr-timer-bar');
    if (timerText) timerText.textContent = `Mã đổi sau: ${remainingSeconds}s`;
    if (timerBar) {
      const pct = Math.max(0, Math.min(100, (remainingSeconds / 30) * 100));
      timerBar.style.width = `${pct}%`;
    }
  }

  function startQrLoop() {
    if (qrTimer) clearInterval(qrTimer);
    refreshQrToken();

    qrTimer = setInterval(() => {
      remainingSeconds--;
      if (remainingSeconds <= 0) {
        refreshQrToken();
      } else {
        updateTimerDisplay();
      }
    }, 1000);
  }

  async function loadShiftAttendance() {
    const body = document.getElementById('attendance-body');
    const emptyNotice = document.getElementById('attendance-empty');
    const summaryText = document.getElementById('attendance-summary-text');
    const today = getTodayIso();

    if (summaryText) {
      summaryText.textContent = `Hôm nay: ${today} • Ca: ${activeShift}`;
    }

    try {
      const res = await api.client.rpc('admin_get_shift_attendance', {
        p_date: today,
        p_shift: activeShift,
      });

      if (res.error) {
        console.error('Lỗi tải danh sách điểm danh:', res.error);
        return;
      }

      const data = res.data;
      if (!data) return;

      // Cập nhật thống kê
      const stats = data.stats || {};
      document.getElementById('stat-present').textContent = stats.present || 0;
      document.getElementById('stat-late').textContent = stats.late || 0;
      document.getElementById('stat-excused').textContent = stats.excused || 0;
      document.getElementById('stat-unexcused').textContent = stats.unexcused || 0;

      // Render danh sách sinh viên
      if (!body) return;
      body.innerHTML = '';

      const records = data.records || [];
      if (records.length === 0) {
        if (emptyNotice) emptyNotice.hidden = false;
        return;
      }
      if (emptyNotice) emptyNotice.hidden = true;

      records.forEach(row => {
        const tr = document.createElement('tr');

        // MSSV
        const tdMssv = document.createElement('td');
        tdMssv.textContent = row.studentId;
        tr.appendChild(tdMssv);

        // Họ tên
        const tdName = document.createElement('td');
        tdName.innerHTML = `<strong>${row.displayName}</strong>`;
        tr.appendChild(tdName);

        // Trạng thái badge
        const tdStatus = document.createElement('td');
        const badge = document.createElement('span');
        badge.className = 'badge';
        if (row.status === 'Có mặt') badge.classList.add('present');
        else if (row.status === 'Đi trễ') badge.classList.add('late');
        else if (row.status === 'Vắng có phép') badge.classList.add('excused');
        else if (row.status === 'Vắng không phép') badge.classList.add('unexcused');
        else badge.classList.add('pending');
        badge.textContent = row.status;
        tdStatus.appendChild(badge);
        tr.appendChild(tdStatus);

        // Giờ quét
        const tdTime = document.createElement('td');
        if (row.scannedAt) {
          const d = new Date(row.scannedAt);
          tdTime.textContent = new Intl.DateTimeFormat('vi-VN', {
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            timeZone: 'Asia/Ho_Chi_Minh'
          }).format(d);
        } else {
          tdTime.textContent = '—';
          tdTime.className = 'muted';
        }
        tr.appendChild(tdTime);

        // Thiết bị
        const tdDev = document.createElement('td');
        if (row.deviceBound) {
          const devBadge = document.createElement('span');
          devBadge.className = 'badge locked';
          devBadge.textContent = 'Đã khóa';
          tdDev.appendChild(devBadge);

          const unlockBtn = document.createElement('button');
          unlockBtn.type = 'button';
          unlockBtn.className = 'plain';
          unlockBtn.style.fontSize = '0.8rem';
          unlockBtn.style.marginLeft = '6px';
          unlockBtn.textContent = 'Mở khóa';
          unlockBtn.onclick = () => openResetDeviceModal(row);
          tdDev.appendChild(unlockBtn);
        } else {
          const freeBadge = document.createElement('span');
          freeBadge.className = 'badge disabled';
          freeBadge.textContent = 'Chưa khóa';
          tdDev.appendChild(freeBadge);
        }
        tr.appendChild(tdDev);

        // Thao tác can thiệp
        const tdAct = document.createElement('td');
        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'secondary small';
        editBtn.textContent = 'Sửa trạng thái';
        editBtn.onclick = () => openEditModal(row);
        tdAct.appendChild(editBtn);
        tr.appendChild(tdAct);

        body.appendChild(tr);
      });
    } catch (e) {
      console.error('Lỗi khi render bảng điểm danh:', e);
    }
  }

  function openEditModal(row) {
    const dialog = document.getElementById('attendance-dialog');
    if (!dialog) return;

    document.getElementById('att-edit-name').textContent = row.displayName;
    document.getElementById('att-edit-mssv').textContent = row.studentId;
    document.getElementById('att-edit-shift-date').textContent = `${activeShift} (${getTodayIso()})`;
    document.getElementById('att-edit-profile-id').value = row.profileId;
    document.getElementById('att-edit-status').value = row.status === 'Chưa điểm danh' ? 'Có mặt' : row.status;
    document.getElementById('att-edit-reason').value = row.note || '';

    const statusEl = document.getElementById('att-edit-status-msg');
    if (statusEl) statusEl.textContent = '';

    dialog.showModal();
  }

  function openResetDeviceModal(row) {
    const dialog = document.getElementById('device-reset-dialog');
    if (!dialog) return;

    document.getElementById('dev-reset-name').textContent = row.displayName;
    document.getElementById('dev-reset-mssv').textContent = row.studentId;
    document.getElementById('dev-reset-profile-id').value = row.profileId;
    document.getElementById('dev-reset-reason').value = '';

    const statusEl = document.getElementById('dev-reset-status-msg');
    if (statusEl) statusEl.textContent = '';

    dialog.showModal();
  }

  function setupEventHandlers() {
    // Chuyển ca: Sáng, Chiều, Tối
    document.querySelectorAll('.shift-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.shift-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeShift = btn.dataset.shift;
        const shiftBadge = document.getElementById('qr-shift-badge');
        if (shiftBadge) shiftBadge.textContent = `Ca ${activeShift}`;
        loadShiftAttendance();
      });
    });

    // Form sửa trạng thái điểm danh
    const editForm = document.getElementById('attendance-edit-form');
    if (editForm) {
      editForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const profileId = document.getElementById('att-edit-profile-id').value;
        const status = document.getElementById('att-edit-status').value;
        const reason = document.getElementById('att-edit-reason').value;
        const statusEl = document.getElementById('att-edit-status-msg');
        const saveBtn = document.getElementById('btn-save-attendance');

        if (statusEl) { statusEl.textContent = 'Đang cập nhật...'; statusEl.className = 'status'; }
        if (saveBtn) saveBtn.disabled = true;

        try {
          const res = await api.client.rpc('admin_update_attendance', {
            p_profile_id: profileId,
            p_date: getTodayIso(),
            p_shift: activeShift,
            p_status: status,
            p_reason: reason,
          });

          if (res.error) {
            if (statusEl) {
              statusEl.textContent = api.message(res.error);
              statusEl.className = 'status error';
            }
          } else {
            document.getElementById('attendance-dialog').close();
            loadShiftAttendance();
          }
        } catch (err) {
          if (statusEl) {
            statusEl.textContent = err.message || 'Lỗi cập nhật';
            statusEl.className = 'status error';
          }
        } finally {
          if (saveBtn) saveBtn.disabled = false;
        }
      });
    }

    // Đóng dialog sửa điểm danh
    document.getElementById('close-att-dialog')?.addEventListener('click', () => {
      document.getElementById('attendance-dialog')?.close();
    });

    // Form mở khóa thiết bị
    const devResetForm = document.getElementById('device-reset-form');
    if (devResetForm) {
      devResetForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const profileId = document.getElementById('dev-reset-profile-id').value;
        const reason = document.getElementById('dev-reset-reason').value;
        const statusEl = document.getElementById('dev-reset-status-msg');
        const resetBtn = document.getElementById('btn-save-device-reset');

        if (statusEl) { statusEl.textContent = 'Đang mở khóa...'; statusEl.className = 'status'; }
        if (resetBtn) resetBtn.disabled = true;

        try {
          const res = await api.client.rpc('admin_reset_device', {
            p_profile_id: profileId,
            p_reason: reason,
          });

          if (res.error) {
            if (statusEl) {
              statusEl.textContent = api.message(res.error);
              statusEl.className = 'status error';
            }
          } else {
            document.getElementById('device-reset-dialog').close();
            loadShiftAttendance();
          }
        } catch (err) {
          if (statusEl) {
            statusEl.textContent = err.message || 'Lỗi mở khóa';
            statusEl.className = 'status error';
          }
        } finally {
          if (resetBtn) resetBtn.disabled = false;
        }
      });
    }

    // Đóng dialog mở khóa thiết bị
    document.getElementById('close-dev-dialog')?.addEventListener('click', () => {
      document.getElementById('device-reset-dialog')?.close();
    });

    // Phóng to QR
    document.getElementById('btn-fullscreen-qr')?.addEventListener('click', () => {
      document.getElementById('qr-fullscreen-dialog')?.showModal();
    });
    document.getElementById('close-fs-qr')?.addEventListener('click', () => {
      document.getElementById('qr-fullscreen-dialog')?.close();
    });
  }

  function init() {
    activeShift = detectShift();

    // Chọn đúng nút tab theo ca
    document.querySelectorAll('.shift-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.shift === activeShift);
    });
    const shiftBadge = document.getElementById('qr-shift-badge');
    if (shiftBadge) shiftBadge.textContent = `Ca ${activeShift}`;

    setupEventHandlers();
    startQrLoop();
    loadShiftAttendance();

    // Tự động làm mới bảng điểm danh sau mỗi 10 giây để thấy sinh viên quét mới
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(loadShiftAttendance, 10000);
  }

  root.AttendanceLive = Object.freeze({
    init,
    load: () => {
      loadShiftAttendance();
      refreshQrToken();
    },
    stop: () => {
      if (qrTimer) clearInterval(qrTimer);
      if (pollTimer) clearInterval(pollTimer);
    }
  });

})(globalThis);
