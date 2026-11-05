/* Logic Auth/QR cho giao diện điểm danh gốc. Không thay bố cục hoặc CSS. */
(function(root) {
  'use strict';
  const api = root.Attendance;
  if (!api) {
    document.getElementById('registerScreen').classList.remove('hidden');
    const alert = document.getElementById('registerAlert');
    alert.classList.remove('hidden'); alert.textContent = 'Không tải được hệ thống. Vui lòng tải lại trang.';
    document.getElementById('btnRegister').disabled = true;
    root.handleRegisterDevice = event => event.preventDefault();
    return;
  }
  const el = id => document.getElementById(id);
  let current = null, caps = null, verified = false, busy = false, refreshing = false;
  let scanner = null, cameraOn = false, cameraStarting = false, deadline = 0, generation = 0, pendingToken = null;
  let stickyResult = false;
  const messages = {
    APP_OUTSIDE_WINDOW: 'Hiện ngoài giờ nhận điểm danh.', APP_SESSION_CLOSED: 'Ca điểm danh đã chốt.',
    APP_QR_PAUSED: 'Mã QR đang tạm dừng phát. Vui lòng đợi quản trị viên mở lại để quét.',
    APP_TEST_MODE_EXPIRED: 'Phiên thử đã hết hạn hoặc bị tắt. Tải lại trang để kiểm tra.',
    APP_DEVICE_IN_USE: 'Trình duyệt này đã gắn với tài khoản khác. Liên hệ quản trị viên để mở khóa.',
    APP_DEVICE_MISMATCH: 'Thiết bị không khớp. Dùng trình duyệt đã đăng ký hoặc liên hệ quản trị viên để mở khóa.',
  };
  const errorText = error => Object.entries(messages).find(([code]) => String(error?.message).includes(code))?.[1] || api.message(error);
  const rpc = async (name, args) => api.checkResult(await api.client.rpc(name,args)).data;
  function token() {
    const key = 'lhtech_device_token_v2';
    const readCookie = () => { try { const m = (document.cookie || '').split('; ').find(r => r.startsWith(key + '=')); return m ? decodeURIComponent(m.slice(key.length + 1)) : ''; } catch (_) { return ''; } };
    const writeCookie = v => { try { document.cookie = `${key}=${encodeURIComponent(v)}; max-age=31536000; path=/; SameSite=Lax${root.location.protocol === 'https:' ? '; Secure' : ''}`; } catch (_) {} };
    let value = root.localStorage.getItem(key) || readCookie();
    if (value && value.length >= 10 && value.length <= 255) { root.localStorage.setItem(key, value); writeCookie(value); return value; }
    value = root.localStorage.getItem('qr_device_id') || root.localStorage.getItem('lhtech_device_fp');
    if (!value || value.length < 10 || value.length > 255) value = Array.from(root.crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('');
    root.localStorage.setItem(key,value); writeCookie(value); return value;
  }
  function ready() { return verified && caps?.qrEnabled === true && caps?.canScan === true && performance.now() < deadline; }
  function controls() {
    el('btnRegister').disabled = busy || caps?.qrEnabled !== true;
    el('btnResumeScan').disabled = busy || !ready() || cameraStarting;
  }
  function registration(message = '', error = false) {
    el('scannerScreen').classList.add('hidden'); el('registerScreen').classList.remove('hidden');
    const alert = el('registerAlert');
    alert.textContent = message;
    alert.className = `mt-4 p-3.5 rounded-xl text-xs font-medium border text-center ${error ? 'text-rose-300 border-rose-500/30 bg-rose-500/10' : 'text-amber-300 border-amber-500/30 bg-amber-500/10'}`;
    alert.classList.toggle('hidden',!message);
  }
  function scanMessage(kind,title,message,resume=true) {
    root.showScanResult(kind,title,message); el('btnResumeScan').classList.toggle('hidden',!resume); controls();
  }
  function displayIdentity() {
    el('registerScreen').classList.add('hidden'); el('scannerScreen').classList.remove('hidden');
    el('displayName').textContent = current.profile.displayName;
    el('displayUserId').textContent = `MSV: ${current.profile.studentId}`;
    el('displayDepartment').textContent = `Lớp: ${current.profile.department || '---'}`;
    // Không hiển thị khóa bí mật thiết bị trên giao diện.
    el('displayDeviceId').textContent = 'ID: Đã xác minh';
  }
  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = String(text);
    return element;
  }
  let historySection = null, historyNotice = null, historyList = null, historyRefreshBtn = null;
  function ensureHistorySection() {
    if (historySection) return;
    const screen = el('scannerScreen');
    if (!screen) return;
    historySection = node('section', 'mt-4 bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3');
    const header = node('div', 'flex justify-between items-center gap-2');
    const title = node('h2', 'text-sm font-bold text-white', 'Lịch sử điểm danh gần đây');
    historyRefreshBtn = node('button', 'text-xs text-emerald-300 px-2 py-1.5 rounded-lg bg-emerald-500/10', 'Làm mới');
    historyRefreshBtn.type = 'button';
    historyRefreshBtn.addEventListener('click', () => { void loadMyAttendance(); });
    header.append(title);
    header.append(historyRefreshBtn);
    historyNotice = node('p', 'text-xs text-slate-400', 'Đang tải lịch sử điểm danh…');
    historyList = node('div', 'space-y-2');
    historySection.append(header);
    historySection.append(historyNotice);
    historySection.append(historyList);
    screen.append(historySection);
  }
  async function loadMyAttendance() {
    if (!current || !verified) return;
    ensureHistorySection();
    if (!historyList || !historyNotice) return;
    const version = generation;
    if (historyRefreshBtn) historyRefreshBtn.disabled = true;
    try {
      const rows = await rpc('get_my_attendance', { p_limit: 10 });
      if (version !== generation) return;
      historyList.replaceChildren();
      const list = Array.isArray(rows) ? rows : [];
      if (!list.length) {
        historyNotice.textContent = 'Chưa có lượt điểm danh nào được ghi nhận.';
        return;
      }
      historyNotice.textContent = `Hiển thị ${list.length} ca gần nhất của bạn.`;
      for (const item of list) {
        const card = node('article', 'rounded-xl border border-slate-800 bg-slate-950/60 p-3 flex items-center justify-between gap-3');
        const left = node('div', 'min-w-0 space-y-0.5');
        const dateText = String(item.date || '').split('-').reverse().join('/');
        left.append(node('p', 'text-xs font-semibold text-white', `${dateText} · Ca ${item.shift || ''}`));
        const timeText = item.scannedAt ? new Date(item.scannedAt).toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Chốt tự động';
        left.append(node('p', 'text-[11px] text-slate-400 font-mono', `Giờ ghi nhận: ${timeText}`));
        const statusColor = item.status === 'Có mặt' ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30'
          : item.status === 'Đi trễ' ? 'text-orange-300 bg-orange-500/10 border-orange-500/30'
          : item.status === 'Vắng có phép' ? 'text-amber-300 bg-amber-500/10 border-amber-500/30'
          : 'text-rose-300 bg-rose-500/10 border-rose-500/30';
        const badge = node('span', `text-[11px] font-bold px-2.5 py-1 rounded-full border shrink-0 ${statusColor}`, item.status || '---');
        card.append(left);
        card.append(badge);
        historyList.append(card);
      }
    } catch (_) {
      if (version === generation && historyNotice) historyNotice.textContent = 'Không tải được lịch sử điểm danh.';
    } finally {
      if (historyRefreshBtn) historyRefreshBtn.disabled = false;
    }
  }
  let currentZoom = 1.0;
  let autoZoomEnabled = true; // Mặc định BẬT để hỗ trợ sinh viên quét màn hình OLED nhỏ
  let autoZoomTimer1 = null;
  let autoZoomTimer2 = null;
  let trackerInterval = null;
  let barcodeDetector = null;

  if ('BarcodeDetector' in root) {
    try {
      barcodeDetector = new root.BarcodeDetector({ formats: ['qr_code'] });
    } catch (_) {}
  }

  function clearAutoZoomTimers() {
    if (autoZoomTimer1) { clearTimeout(autoZoomTimer1); autoZoomTimer1 = null; }
    if (autoZoomTimer2) { clearTimeout(autoZoomTimer2); autoZoomTimer2 = null; }
  }

  function startAutoZoomSequence() {
    clearAutoZoomTimers();
    if (!autoZoomEnabled || !cameraOn) return;

    // Sau 1.5 giây nếu camera đang chạy ở 1.0x mà chưa quét được (đang đứng cách xa), tự động phóng to lên 2.0x
    autoZoomTimer1 = setTimeout(() => {
      if (cameraOn && !busy && currentZoom === 1.0 && autoZoomEnabled) {
        void root.setCameraZoom(2.0, false);
        const hint = el('cameraHintText');
        if (hint) hint.innerText = 'Đang tự phóng to 2x để bắt mã OLED...';

        // Sau tiếp 2.5 giây ở 2.0x nếu vẫn chưa quét được, tự động zoom tiếp lên 2.5x
        autoZoomTimer2 = setTimeout(() => {
          if (cameraOn && !busy && currentZoom === 2.0 && autoZoomEnabled) {
            void root.setCameraZoom(2.5, false);
            if (hint) hint.innerText = 'Đang tự phóng to 2.5x để đọc mã...';
          }
        }, 2500);
      }
    }, 1500);
  }

  function updateZoomButtons(zoomLevel) {
    const activeClass = 'w-8 h-8 rounded-full text-xs font-bold transition flex items-center justify-center bg-emerald-500/25 text-emerald-400 border border-emerald-500/40 shadow-sm cursor-pointer active:scale-95';
    const inactiveClass = 'w-8 h-8 rounded-full text-xs font-bold transition flex items-center justify-center bg-slate-800/80 text-slate-300 hover:text-white border border-slate-700/60 cursor-pointer active:scale-95';

    const b1 = el('btnZoom1x'), b2 = el('btnZoom2x'), b3 = el('btnZoom3x');
    if (b1) b1.className = (zoomLevel <= 1.2) ? activeClass : inactiveClass;
    if (b2) b2.className = (zoomLevel > 1.2 && zoomLevel <= 2.2) ? activeClass : inactiveClass;
    if (b3) b3.className = (zoomLevel > 2.2) ? activeClass : inactiveClass;
  }

  root.setCameraZoom = async function(zoomLevel, manual = false) {
    currentZoom = zoomLevel;
    updateZoomButtons(zoomLevel);

    if (manual) {
      clearAutoZoomTimers();
      const hint = el('cameraHintText');
      if (hint) hint.innerText = `Đã chọn phóng to ${zoomLevel}x`;
    }

    // 1. Luôn áp dụng visual CSS Transform trên video để người dùng nhìn thấy camera phóng to ngay lập tức
    const videoEl = document.querySelector('#reader video');
    if (videoEl) {
      videoEl.style.transform = `scale(${zoomLevel})`;
      videoEl.style.transformOrigin = 'center center';
      videoEl.style.transition = 'transform 0.25s cubic-bezier(0.2, 0, 0, 1)';
    }

    // 2. Thử gọi zoom phần cứng MediaStreamTrack trên camera
    try {
      const track = videoEl?.srcObject?.getVideoTracks?.()[0];
      if (track) {
        const caps = track.getCapabilities ? track.getCapabilities() : {};
        if (caps.zoom) {
          const min = caps.zoom.min || 1;
          const max = caps.zoom.max || 5;
          const target = Math.max(min, Math.min(max, zoomLevel));
          await track.applyConstraints({ advanced: [{ zoom: target }] });
        }
      }
    } catch (_) {}

    // 3. Thử gọi zoom qua thư viện html5-qrcode
    if (scanner) {
      try {
        await scanner.applyVideoConstraints({ advanced: [{ zoom: zoomLevel }] });
      } catch (_) {}
    }
  };

  root.toggleAutoZoom = function() {
    autoZoomEnabled = !autoZoomEnabled;
    const btn = el('btnAutoZoom');
    const label = el('autoZoomLabel');
    if (autoZoomEnabled) {
      if (btn) btn.className = 'px-2.5 h-8 rounded-full text-[11px] font-bold transition flex items-center justify-center gap-1 bg-amber-500/25 text-amber-300 border border-amber-500/50 shadow-sm cursor-pointer active:scale-95';
      if (label) label.innerText = 'Auto: BẬT';
      startAutoZoomSequence();
      root.showToast?.info?.('Đã bật Tự động phóng to khi quét xa');
    } else {
      if (btn) btn.className = 'px-2.5 h-8 rounded-full text-[11px] font-semibold transition flex items-center justify-center gap-1 bg-slate-800/80 text-slate-300 hover:text-white border border-slate-700/60 cursor-pointer active:scale-95';
      if (label) label.innerText = 'Auto';
      clearAutoZoomTimers();
      const hint = el('cameraHintText');
      if (hint) hint.innerText = 'Đã tắt tự động phóng to';
    }
  };

  function highlightReticle(box, videoEl) {
    const reticle = el('qrReticle');
    const container = el('reader');
    if (!reticle || !container || !videoEl || !box) return;

    const videoRect = videoEl.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    if (videoRect.width === 0 || videoEl.videoWidth === 0) return;

    const scaleX = videoRect.width / videoEl.videoWidth;
    const scaleY = videoRect.height / videoEl.videoHeight;

    const left = (box.x * scaleX) + (videoRect.left - containerRect.left);
    const top = (box.y * scaleY) + (videoRect.top - containerRect.top);
    const width = Math.max(50, box.width * scaleX);
    const height = Math.max(50, box.height * scaleY);

    reticle.style.left = `${Math.round(left - 8)}px`;
    reticle.style.top = `${Math.round(top - 8)}px`;
    reticle.style.width = `${Math.round(width + 16)}px`;
    reticle.style.height = `${Math.round(height + 16)}px`;
    reticle.classList.remove('hidden');
    reticle.classList.add('reticle-locked');

    const targetBox = el('scanTargetBox');
    if (targetBox) {
      targetBox.style.borderColor = '#34d399';
      targetBox.style.transform = 'scale(0.96)';
    }
  }

  function hideReticle() {
    const reticle = el('qrReticle');
    if (reticle && !reticle.classList.contains('hidden')) {
      reticle.classList.add('hidden');
      reticle.classList.remove('reticle-locked');
    }
    const targetBox = el('scanTargetBox');
    if (targetBox) {
      targetBox.style.borderColor = '';
      targetBox.style.transform = '';
    }
  }

  function startAutoTracker() {
    stopAutoTracker();
    if (!barcodeDetector) return;

    trackerInterval = setInterval(async () => {
      if (!cameraOn || busy) return;
      const videoEl = document.querySelector('#reader video');
      if (!videoEl || videoEl.readyState < 2) return;

      try {
        const barcodes = await barcodeDetector.detect(videoEl);
        if (barcodes && barcodes.length > 0) {
          const barcode = barcodes[0];
          highlightReticle(barcode.boundingBox, videoEl);
          if (barcode.rawValue && cameraOn && !busy) {
            clearAutoZoomTimers();
            void submit(barcode.rawValue);
          }
        } else {
          hideReticle();
        }
      } catch (_) {
        hideReticle();
      }
    }, 120);
  }

  function stopAutoTracker() {
    if (trackerInterval) {
      clearInterval(trackerInterval);
      trackerInterval = null;
    }
    hideReticle();
  }

  function setupPinchZoom() {
    const container = el('reader');
    if (!container || container.dataset.pinchSetup) return;
    container.dataset.pinchSetup = 'true';

    let initialDist = 0;
    let startZoom = 1.0;

    container.addEventListener('touchstart', e => {
      if (e.touches.length === 2) {
        initialDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        startZoom = currentZoom;
        clearAutoZoomTimers();
      }
    }, { passive: true });

    container.addEventListener('touchmove', e => {
      if (e.touches.length === 2 && initialDist > 0) {
        const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        const factor = dist / initialDist;
        const target = Math.max(1.0, Math.min(3.5, Math.round((startZoom * factor) * 10) / 10));
        void root.setCameraZoom(target, true);
      }
    }, { passive: true });

    container.addEventListener('touchend', e => {
      if (e.touches.length < 2) {
        initialDist = 0;
      }
    }, { passive: true });
  }

  function handleBarcodeSuccess(text, decodedResult) {
    if (!cameraOn || busy) return;
    clearAutoZoomTimers();
    const points = decodedResult?.result?.points;
    const videoEl = document.querySelector('#reader video');
    if (points && points.length >= 2 && videoEl) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const pt of points) {
        if (pt.x < minX) minX = pt.x;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.y > maxY) maxY = pt.y;
      }
      highlightReticle({
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY
      }, videoEl);
    }
    void submit(text);
  }

  async function stopCamera() {
    clearAutoZoomTimers();
    stopAutoTracker();
    if (cameraOn && scanner) {
      cameraOn = false;
      try { await scanner.stop(); scanner.clear(); } catch (_) {}
    }
    el('scanOverlay')?.classList.add('hidden');
    el('zoomControls')?.classList.add('hidden');
    hideReticle();
    currentZoom = 1.0;
    updateZoomButtons(1.0);
    const videoEl = document.querySelector('#reader video');
    if (videoEl) videoEl.style.transform = 'scale(1.0)';
    const hint = el('cameraHintText');
    if (hint) hint.innerText = 'Hướng camera vào mã QR để tự động quét';
  }

  async function capabilities() {
    if (refreshing || !current) return;
    refreshing = true; const version = generation, started = performance.now(), wasReady = ready();
    try {
      const data = await rpc('get_attendance_capabilities'); if (version !== generation) return;
      if (data?.version !== 1 || data.profileId !== current.profile.id) throw Error('Invalid capability response');
      caps = data;
      const remaining = Date.parse(data.window?.endsAt) - Date.parse(data.serverTime);
      deadline = started + (Number.isFinite(remaining) ? Math.max(0,remaining) : 0);
      if (!data.deviceBound && verified) { verified=false; await stopCamera(); registration('Thiết bị đã được mở khóa. Xác nhận để đăng ký lại.'); }
      if (verified) {
        if (!ready()) {
          await stopCamera();
          scanMessage('warning','Chưa nhận điểm danh',!data.qrEnabled ? 'Điểm danh đang tạm dừng để cập nhật.' : !data.window ? 'Hiện ngoài giờ nhận điểm danh.' : data.sessionClosed ? 'Ca điểm danh đã chốt.' : data.isPaused ? 'Quản trị viên đang tạm dừng phát mã QR cho ca này.' : 'Đang chờ quản trị viên mở mã QR.');
        } else if (!cameraOn && !cameraStarting && !stickyResult) {
          void root.resumeScanner();
        }
      }
    } catch(error) {
      if (version !== generation) return;
      caps=null; deadline=0; await stopCamera();
      const text=['PGRST202','42501'].includes(error?.code) ? 'Điểm danh đang chờ quản trị viên hoàn tất cập nhật.' : errorText(error);
      if (verified) scanMessage('warning','Chưa nhận điểm danh',text); else registration(text,true);
    } finally { refreshing=false; controls(); }
  }
  async function verifyDevice() {
    const identity=await api.identity();
    if (!identity || identity.profile.id!==current.profile.id) throw {code:'SESSION_CHANGED'};
    if (el('inputUserId').value.trim()!==current.profile.studentId) throw {message:'APP_INVALID_INPUT'};
    const version=generation;
    const result=await rpc('register_my_device',{p_device_token:token()});
    if (version!==generation) throw {code:'SESSION_CHANGED'};
    if (result?.deviceVerified!==true || result.profileId!==current.profile.id) throw Error('Invalid device response');
    verified=true; displayIdentity(); void loadMyAttendance();
    if (ready() && !cameraOn && !cameraStarting) {
      void root.resumeScanner();
    } else if (pendingToken) {
      scanMessage('warning','Đã nhận mã QR','Bấm Tiếp Tục Quét Lại để xác nhận điểm danh.');
    }
  }
  root.handleRegisterDevice=async event=>{
    event.preventDefault(); if(busy || caps?.qrEnabled!==true) return;
    busy=true; controls();
    try { await verifyDevice(); } catch(error) { verified=false; registration(errorText(error),true); }
    finally { busy=false; await capabilities(); controls(); }
  };
  function parseToken(value) {
    let result=String(value||'').trim();
    if (!/^[a-f0-9]{32}$/.test(result)) {
      try { const url=new URL(result); result=url.searchParams.get('t')||url.searchParams.get('token')||''; } catch(_){result='';}
    }
    if(!/^[a-f0-9]{32}$/.test(result)) throw {message:'APP_INVALID_QR'};
    return result;
  }
  async function submit(value) {
    if (busy || !ready()) return;
    busy=true; controls(); const version=generation;
    await stopCamera(); scanMessage('loading','Đang xử lý','Đang xác nhận điểm danh với hệ thống.',false);
    try {
      const qr=parseToken(value),identity=await api.identity();
      if (!identity || identity.profile.id!==current.profile.id || version!==generation) throw {code:'SESSION_CHANGED'};
      const result=await rpc('submit_attendance',{p_qr_token:qr,p_device_fingerprint:token()});
      if (version!==generation) return;
      const data=result?.data;
      if(result?.success!==true || data?.profileId!==current.profile.id || !data.id || !data.scannedAt || !['Có mặt','Đi trễ'].includes(data.status)) throw Error('Invalid attendance response');
      stickyResult=true;
      scanMessage(true,result.testMode ? (result.alreadyScanned?'THỬ: Đã ghi nhận trước đó':'THỬ: Quét QR thành công') : (result.alreadyScanned?'Đã ghi nhận trước đó':'Điểm danh thành công'),`Ca ${data.shift} · ${data.status} · ${current.profile.displayName}`);
      root.playBeep?.(true); void loadMyAttendance();
    }catch(error) {
      if (version!==generation) return;
      stickyResult=true; scanMessage(false,'Chưa điểm danh được',errorText(error)); root.playBeep?.(false);
    }finally { busy=false; controls(); }
  }
  root.onScanSuccess=value=>submit(value);
  root.resumeScanner=async()=>{
    if(busy || cameraStarting || !verified) return;
    await capabilities(); if(!ready()) return;
    stickyResult=false;
    if(pendingToken){const value=pendingToken;pendingToken=null;await submit(value);return;}
    const version=generation; cameraStarting=true; controls();
    try {
      scanner ||= new root.Html5Qrcode('reader', { verbose: false, formatsToSupport: [0], experimentalFeatures: { useBarCodeDetectorIfSupported: true } });
      await scanner.start(
        { facingMode: 'environment' },
        {
          fps: 20,
          qrbox: (vw, vh) => {
            const minDim = Math.min(vw || 280, vh || 280);
            const s = Math.max(220, Math.floor(minDim * 0.92));
            return { width: s, height: s };
          }
        },
        (text, decodedResult) => {
          handleBarcodeSuccess(text, decodedResult);
        },
        () => {}
      );
      cameraOn=true;
      if(version!==generation || document.hidden || !ready()){await stopCamera();return;}
      el('scanAlert').classList.add('hidden');
      el('btnResumeScan').classList.add('hidden');
      el('scanOverlay').classList.remove('hidden');
      el('zoomControls')?.classList.remove('hidden');
      setupPinchZoom();
      startAutoTracker();
      startAutoZoomSequence();
    }catch(_) {scanMessage(false,'Không mở được camera','Kiểm tra quyền camera của trình duyệt rồi bấm Tiếp Tục Quét Lại.');}
    finally {cameraStarting=false;controls();}
  };
  root.handleSwitchAccount=async()=>{
    const choice=root.prompt('Chọn thao tác:\n1 - Đổi mật khẩu\n2 - Đăng xuất / Đổi tài khoản\nBấm Hủy để giữ nguyên.','1');
    if(choice===null || !String(choice).trim())return;
    if(String(choice).trim()==='1'){
      generation++;caps=null;deadline=0;controls();await stopCamera();
      root.location.assign('reset-password.html');return;
    }
    if(String(choice).trim()!=='2')return;
    generation++; verified=false; caps=null; deadline=0; controls();await stopCamera();
    try { const result=await api.client.auth.signOut({scope:'local'});if(result.error)throw result.error;root.location.replace('index.html'); }
    catch(error){registration(errorText(error),true);}
  };
  api.client.auth.onAuthStateChange((event,session)=>{
    if(event==='SIGNED_OUT'){generation++;verified=false;caps=null;deadline=0;void stopCamera();root.location.replace('index.html');}
    if(event==='SIGNED_IN' && current && session?.user?.id && session.user.id!==current.profile.id){generation++;verified=false;caps=null;deadline=0;void stopCamera();setTimeout(()=>void init(),0);}
  });
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden){generation++;caps=null;deadline=0;void stopCamera();controls();}
    else void capabilities();
  });
  setInterval(()=>{if(!document.hidden)void capabilities();},10000);
  setInterval(()=>{if(cameraOn&&!ready()){void stopCamera();scanMessage('warning','Đã hết giờ','Ca đã hết giờ nhận điểm danh.');}},1000);
  async function init() {
    registration('Đang kiểm tra tài khoản…');controls();el('scanOverlay').classList.add('hidden');
    try {
      current=await api.requireIdentity();if(!current)return;
      el('inputUserId').value=current.profile.studentId;el('inputUserId').readOnly=true;
      const params=new URLSearchParams(root.location.search);pendingToken=params.get('t')||params.get('token')||pendingToken;
      if(params.has('t')||params.has('token'))root.history.replaceState(null,'',root.location.pathname);
      await capabilities();
      if(caps?.qrEnabled&&caps.deviceBound) {try{await verifyDevice();}catch(error){registration(errorText(error),true);}}
      else if(caps?.qrEnabled)registration('Xác nhận để gắn trình duyệt này với tài khoản đang đăng nhập.');
      await capabilities();
      if(verified && ready() && !cameraOn && !cameraStarting) {
        void root.resumeScanner();
      }
    }catch(error){registration(errorText(error),true);}
    controls();
  }
  void init();
})(globalThis);
