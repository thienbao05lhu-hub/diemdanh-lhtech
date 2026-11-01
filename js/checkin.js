/* Điểm danh theo Auth UID; mọi quyết định giờ/ca/thiết bị thuộc database. */
(function (root) {
  'use strict';
  const api = root.Attendance;
  if (!api) return;
  const el = id => document.getElementById(id);
  let current = null, capability = null, verified = false, busy = false;
  let scanner = null, cameraOn = false, refreshing = false, deadline = 0;
  const messages = {
    APP_OUTSIDE_WINDOW: 'Đã ngoài giờ nhận điểm danh. Hãy quay lại trong ca.',
    APP_SESSION_CLOSED: 'Phiên điểm danh đã chốt. Liên hệ quản trị viên nếu cần kiểm tra.',
    APP_DEVICE_IN_USE: 'Trình duyệt này đã gắn với tài khoản khác.',
    APP_DEVICE_MISMATCH: 'Thiết bị chưa khớp. Dùng trình duyệt đã đăng ký hoặc liên hệ quản trị viên để mở khóa.',
  };
  function errorText(error) {
    for (const [code, text] of Object.entries(messages)) if (String(error?.message).includes(code)) return text;
    return api.message(error);
  }
  function status(id, text, error = false) { api.setStatus(el(id), text, error); }
  async function rpc(name, args) { return api.checkResult(await api.client.rpc(name, args)).data; }
  function ready() {
    return !busy && verified && capability?.qrEnabled === true && capability?.canScan === true && performance.now() < deadline;
  }
  function controls() {
    el('verify-device').disabled = busy || capability?.qrEnabled !== true;
    el('start-camera').disabled = !ready() || cameraOn;
    el('submit-token').disabled = !ready();
    el('qr-token').disabled = !ready();
  }
  function deviceToken() {
    const key = 'lhtech_device_token_v2';
    let value = root.localStorage.getItem(key);
    if (value && value.length >= 10 && value.length <= 255) return value;
    // Chỉ tái sử dụng khóa lưu ở trình duyệt; server kiểm tra nó với binding cũ.
    value = root.localStorage.getItem('qr_device_id') || root.localStorage.getItem('lhtech_device_fp');
    if (!value || value.length < 10 || value.length > 255) {
      value = Array.from(root.crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('');
    }
    root.localStorage.setItem(key, value);
    return value;
  }
  async function stopCamera() {
    if (scanner && cameraOn) {
      cameraOn = false;
      try { await scanner.stop(); await scanner.clear(); } catch (_) { /* Stop may already be complete. */ }
    }
    el('stop-camera').hidden = true;
    controls();
  }
  async function capabilities() {
    if (refreshing || !current) return;
    refreshing = true;
    const started = performance.now();
    try {
      const data = await rpc('get_attendance_capabilities');
      if (!data || data.version !== 1 || data.profileId !== current.profile.id) throw new Error('Invalid capability response');
      capability = data;
      const remaining = Date.parse(data.window?.endsAt) - Date.parse(data.serverTime);
      // Trừ cả thời gian request để không giữ nút bật quá cận server.
      deadline = started + (Number.isFinite(remaining) ? Math.max(0, remaining) : 0);
      if (!data.deviceBound) verified = false;
      status('session-status', !data.qrEnabled ? 'Điểm danh đang tạm dừng để cập nhật.'
        : !data.window ? 'Hiện ngoài giờ nhận điểm danh.'
        : data.sessionClosed ? `Ca ${data.window.shift} đã chốt.`
        : !data.sessionId ? `Ca ${data.window.shift}: đang chờ quản trị viên mở mã QR.`
        : `Ca ${data.window.shift} đang nhận điểm danh.`);
      if (!ready()) await stopCamera();
    } catch (error) {
      capability = null; deadline = 0;
      status('session-status', error?.code === 'PGRST202' || error?.code === '42501'
        ? 'Điểm danh đang chờ quản trị viên hoàn tất cập nhật.' : errorText(error), true);
      await stopCamera();
    } finally { refreshing = false; controls(); }
  }
  async function history() {
    el('reload-history').disabled = true;
    el('history-rows').replaceChildren();
    try {
      const rows = await rpc('get_my_attendance', { p_limit: 30 });
      if (!Array.isArray(rows)) throw new Error('Invalid history response');
      for (const row of rows) {
        const tr = document.createElement('tr');
        const stamp = ['Có mặt','Đi trễ'].includes(row.status) && row.scannedAt ? new Date(row.scannedAt) : null;
        const time = stamp && Number.isFinite(stamp.getTime())
          ? stamp.toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : '—';
        for (const value of [row.date, row.shift, row.status, time]) {
          const td = document.createElement('td'); td.textContent = value || '—'; tr.append(td);
        }
        el('history-rows').append(tr);
      }
      status('history-status', rows.length ? 'Tối đa 30 lần ghi nhận gần nhất.' : 'Chưa có dữ liệu điểm danh.');
    } catch (error) { status('history-status', errorText(error), true); }
    finally { el('reload-history').disabled = false; }
  }
  function parseToken(value) {
    let token = String(value || '').trim();
    if (!/^[a-f0-9]{32}$/.test(token)) {
      try { const url = new URL(token); token = url.searchParams.get('t') || url.searchParams.get('token') || ''; }
      catch (_) { token = ''; }
    }
    if (!/^[a-f0-9]{32}$/.test(token)) throw { message: 'APP_INVALID_QR' };
    return token;
  }
  async function submit(value) {
    if (!ready()) { status('scan-result', 'Hãy xác minh thiết bị và chờ phiên điểm danh mở.', true); return; }
    busy = true; controls(); status('scan-result', 'Đang gửi điểm danh…');
    try {
      const token = parseToken(value);
      await stopCamera();
      const identity = await api.identity();
      if (!identity || identity.profile.id !== current.profile.id) throw { code: 'SESSION_CHANGED' };
      const result = await rpc('submit_attendance', { p_qr_token: token, p_device_fingerprint: deviceToken() });
      const data = result?.data;
      if (result?.success !== true || data?.profileId !== current.profile.id || !data.id || !data.scannedAt
        || !['Có mặt','Đi trễ'].includes(data.status)) throw new Error('Invalid attendance response');
      status('scan-result', `${result.alreadyScanned ? 'Đã ghi nhận trước đó' : 'Điểm danh thành công'}: ca ${data.shift}, ${data.status}.`);
      el('qr-token').value = '';
      await history();
    } catch (error) {
      if (String(error?.message).includes('APP_DEVICE_')) verified = false;
      status('scan-result', errorText(error), true);
    } finally { busy = false; await capabilities(); controls(); }
  }
  el('verify-device').addEventListener('click', async () => {
    busy = true; verified = false; controls(); await stopCamera();
    try {
      const identity = await api.identity();
      if (!identity || identity.profile.id !== current.profile.id) throw { code: 'SESSION_CHANGED' };
      const result = await rpc('register_my_device', { p_device_token: deviceToken() });
      if (result?.profileId !== current.profile.id || result.deviceVerified !== true) throw new Error('Invalid device response');
      verified = true; status('device-status', 'Đã xác minh trình duyệt này.');
    } catch (error) { status('device-status', errorText(error), true); }
    finally { busy = false; controls(); }
  });
  el('token-form').addEventListener('submit', event => { event.preventDefault(); void submit(el('qr-token').value); });
  el('start-camera').addEventListener('click', async () => {
    if (!ready() || cameraOn) return;
    el('start-camera').disabled = true;
    try {
      scanner ||= new root.Html5Qrcode('qr-reader');
      await scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 220, height: 220 } },
        text => { if (cameraOn && !busy) void submit(text); }, () => {});
      cameraOn = true; el('stop-camera').hidden = false; status('camera-status', 'Đưa mã QR vào khung camera.');
      if (!ready() || document.hidden) await stopCamera();
    } catch (_) { status('camera-status', 'Không mở được camera. Kiểm tra quyền camera hoặc dán mã vừa quét vào ô bên dưới.', true); }
    controls();
  });
  el('stop-camera').addEventListener('click', () => void stopCamera());
  el('reload-history').addEventListener('click', () => void history());
  el('retry-page').addEventListener('click', () => void init());
  api.bindLogout(el('page-status'));
  api.client.auth.onAuthStateChange(event => {
    if (event === 'SIGNED_OUT' || event === 'SIGNED_IN') {
      verified = false; capability = null; deadline = 0; void stopCamera();
    }
  });
  async function init() {
    el('retry-page').hidden = true;
    try {
      current = await api.requireIdentity(); if (!current) return;
      el('current-user').textContent = `${current.profile.displayName} (${current.profile.studentId})`;
      el('admin-link').hidden = !api.adminRoles.includes(current.profile.role);
      el('protected-content').hidden = false; status('page-status', '');
      const params = new URLSearchParams(root.location.search);
      const token = params.get('t') || params.get('token');
      if (token) { el('qr-token').value = token.slice(0, 2048); root.history.replaceState(null, '', root.location.pathname); }
      await capabilities(); await history();
    } catch (error) { status('page-status', errorText(error), true); el('retry-page').hidden = false; }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { verified = false; capability = null; void stopCamera(); }
    else void capabilities();
  });
  setInterval(() => {
    if (!document.hidden) {
      controls(); if (performance.now() >= deadline && cameraOn) void stopCamera();
    }
  }, 1000);
  setInterval(() => { if (!document.hidden) void capabilities(); }, 10000);
  void init();
})(globalThis);
