/**
 * Quét mã QR Điểm danh phía Sinh viên + Tự động khóa thiết bị chống điểm danh hộ
 */
(function (root) {
  'use strict';

  const api = root.Attendance;
  if (!api) return;

  const status = document.getElementById('page-status');
  const content = document.getElementById('protected-content');
  const retry = document.getElementById('retry-page');
  const camStatus = document.getElementById('camera-status');
  const resultCard = document.getElementById('scan-result-card');
  const resultAlert = document.getElementById('scan-result-alert');

  let html5QrScanner = null;
  let isScanning = false;
  let currentProfile = null;
  let isSubmitting = false;

  api.bindLogout(status);

  // 1. Nhận diện và khóa cứng dấu vân tay thiết bị (Device Fingerprint)
  function getDeviceFingerprint() {
    let fp = root.localStorage.getItem('lhtech_device_fp');
    if (!fp || fp.length < 10) {
      const entropy = [
        navigator.userAgent || '',
        `${screen.width}x${screen.height}`,
        Intl.DateTimeFormat().resolvedOptions().timeZone || '',
        Math.random().toString(36).substring(2, 15),
        Date.now().toString(36),
      ].join('::');
      try {
        fp = 'dev_' + btoa(unescape(encodeURIComponent(entropy))).replace(/[^a-zA-Z0-9]/g, '').slice(0, 42);
      } catch (e) {
        fp = 'dev_' + Math.random().toString(36).slice(2) + Date.now();
      }
      if (fp.length < 12) {
        fp = 'dev_' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      }
      root.localStorage.setItem('lhtech_device_fp', fp);
    }
    return fp;
  }

  // 2. Gửi điểm danh lên Supabase RPC
  async function submitAttendance(rawToken) {
    if (isSubmitting) return;
    isSubmitting = true;

    // Trích xuất token nếu chuỗi quét là đường link (URL)
    let token = (rawToken || '').trim();
    if (token.includes('?')) {
      try {
        const u = new URL(token, root.location.origin);
        token = u.searchParams.get('t') || u.searchParams.get('token') || token;
      } catch (e) {}
    }

    const deviceFingerprint = getDeviceFingerprint();

    showResult('info', 'Đang gửi thông tin điểm danh...');

    try {
      const res = await api.client.rpc('submit_attendance', {
        p_qr_token: token,
        p_device_fingerprint: deviceFingerprint,
      });

      if (res.error) {
        const errCode = res.error.message || res.error.code;
        if (errCode === 'APP_DEVICE_MISMATCH') {
          showResult('error', '⚠️ THIẾT BỊ KHÔNG KHỚP: Tài khoản của bạn đã được gắn cố định với thiết bị khác để chống điểm danh hộ. Nếu bạn đổi điện thoại, hãy gặp giảng viên/quản trị viên để mở khóa thiết bị.');
        } else if (errCode === 'APP_INVALID_QR') {
          showResult('warning', '⏳ MÃ QR HẾT HẠN HOẶC SAI: Mã QR động được đổi mới mỗi 30 giây. Vui lòng quét lại mã đang hiển thị trên màn hình xưởng.');
        } else if (errCode === 'APP_SHIFT_LOCKED') {
          showResult('error', 'Ca điểm danh này đã được chốt và khóa sổ.');
        } else {
          showResult('error', api.message(res.error) || 'Lỗi điểm danh');
        }
      } else {
        const d = res.data;
        if (d && d.alreadyScanned) {
          showResult('info', `ℹ️ ${d.message}`);
        } else if (d && d.success) {
          showResult('success', `✅ ${d.message} • Thời gian: ${new Date().toLocaleTimeString('vi-VN')}`);
          // Rung điện thoại báo hiệu thành công nếu trình duyệt hỗ trợ
          if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
        } else {
          showResult('success', 'Điểm danh thành công!');
        }
        loadMyHistory();
      }
    } catch (err) {
      showResult('error', 'Không thể kết nối đến máy chủ. Vui lòng kiểm tra lại mạng.');
    } finally {
      isSubmitting = false;
      // Chờ 3 giây trước khi cho phép quét tiếp
      setTimeout(() => { isSubmitting = false; }, 3000);
    }
  }

  function showResult(type, message) {
    if (!resultCard || !resultAlert) return;
    resultCard.hidden = false;
    resultAlert.className = `scan-alert ${type}`;
    resultAlert.textContent = message;
    resultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // 3. Tải lịch sử điểm danh của bản thân
  async function loadMyHistory() {
    const body = document.getElementById('my-attendance-body');
    const emptyNotice = document.getElementById('history-empty');
    if (!body) return;

    try {
      const res = await api.client.rpc('get_my_attendance', { p_limit: 15 });
      if (res.error) {
        console.error('Lỗi tải lịch sử:', res.error);
        return;
      }

      const rows = res.data || [];
      body.innerHTML = '';

      if (rows.length === 0) {
        if (emptyNotice) emptyNotice.hidden = false;
        return;
      }
      if (emptyNotice) emptyNotice.hidden = true;

      rows.forEach(r => {
        const tr = document.createElement('tr');

        // Ngày
        const tdDate = document.createElement('td');
        tdDate.textContent = r.date;
        tr.appendChild(tdDate);

        // Ca
        const tdShift = document.createElement('td');
        tdShift.textContent = `Ca ${r.shift}`;
        tr.appendChild(tdShift);

        // Trạng thái badge
        const tdStatus = document.createElement('td');
        const b = document.createElement('span');
        b.className = 'badge';
        if (r.status === 'Có mặt') b.classList.add('present');
        else if (r.status === 'Đi trễ') b.classList.add('late');
        else if (r.status === 'Vắng có phép') b.classList.add('excused');
        else if (r.status === 'Vắng không phép') b.classList.add('unexcused');
        b.textContent = r.status;
        tdStatus.appendChild(b);
        tr.appendChild(tdStatus);

        // Giờ quét
        const tdTime = document.createElement('td');
        if (r.scannedAt) {
          const d = new Date(r.scannedAt);
          tdTime.textContent = d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        } else {
          tdTime.textContent = '—';
        }
        tr.appendChild(tdTime);

        body.appendChild(tr);
      });
    } catch (e) {
      console.error('Ngoại lệ khi tải lịch sử:', e);
    }
  }

  // 4. Khởi chạy Camera QR Scanner
  function startCameraScanner() {
    if (!root.Html5Qrcode) {
      if (camStatus) camStatus.textContent = 'Trình duyệt chưa sẵn sàng mở camera.';
      return;
    }

    if (html5QrScanner) {
      try {
        html5QrScanner.stop().catch(() => {}).finally(() => {
          html5QrScanner = null;
          isScanning = false;
          if (camStatus) camStatus.textContent = 'Camera đã tắt.';
        });
      } catch (e) {}
      return;
    }

    if (camStatus) camStatus.textContent = 'Đang bật camera… Hãy cấp quyền truy cập nếu được hỏi.';

    html5QrScanner = new root.Html5Qrcode('qr-reader');
    const qrConfig = { fps: 10, qrbox: { width: 250, height: 250 } };

    html5QrScanner.start(
      { facingMode: 'environment' },
      qrConfig,
      (decodedText) => {
        // Quét thành công
        if (!isSubmitting) {
          submitAttendance(decodedText);
        }
      },
      (error) => {
        // Lỗi khung hình (bình thường khi chưa khớp QR)
      }
    ).then(() => {
      isScanning = true;
      if (camStatus) camStatus.textContent = 'Camera đang hoạt động. Hãy hướng vào mã QR.';
    }).catch(err => {
      isScanning = false;
      html5QrScanner = null;
      if (camStatus) {
        camStatus.textContent = 'Không mở được camera (chưa cấp quyền hoặc không có thiết bị). Bạn có thể dùng ô nhập mã bên dưới.';
      }
    });
  }

  // 5. Khởi tạo trang
  async function init() {
    api.setStatus(status, 'Đang xác thực tài khoản…');
    if (retry) retry.hidden = true;

    try {
      const current = await api.requireIdentity();
      if (!current) return;

      currentProfile = current.profile;
      document.getElementById('signed-in-name').textContent = `${currentProfile.displayName} (${currentProfile.studentId})`;
      content.hidden = false;
      api.setStatus(status);

      // Bật camera
      startCameraScanner();

      // Nút bật/tắt camera
      document.getElementById('btn-toggle-camera')?.addEventListener('click', startCameraScanner);

      // Form nhập token thủ công
      document.getElementById('manual-token-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const input = document.getElementById('input-qr-token');
        if (input && input.value) {
          submitAttendance(input.value);
        }
      });

      // Nút tải lại lịch sử
      document.getElementById('btn-reload-history')?.addEventListener('click', loadMyHistory);

      // Tải lịch sử ban đầu
      loadMyHistory();

    } catch (err) {
      api.setStatus(status, api.message(err), true);
      if (retry) retry.hidden = false;
    }
  }

  if (retry) retry.addEventListener('click', init);
  init();

})(globalThis);

