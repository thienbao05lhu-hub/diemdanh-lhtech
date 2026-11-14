/**
 * LH-TECH PWA Installer & Quick Launch Controller
 * Hỗ trợ cài đặt ứng dụng vào màn hình chính cho Android, iOS và Desktop
 */
(function(root) {
  'use strict';

  // 1. Đăng ký Service Worker
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }

  // 2. Nhận diện thiết bị và chế độ standalone
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIos = /iphone|ipad|ipod/.test(window.navigator.userAgent.toLowerCase());
  let deferredPrompt = null;
  let bannerDismissed = sessionStorage.getItem('pwa_banner_dismissed') === 'true';

  // 3. Lắng nghe sự kiện trước khi cài đặt PWA
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    renderInstallBanner();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    removeInstallBanner();
    if (typeof root.showToast === 'function') {
      root.showToast('🎉 Đã cài đặt thành công App Điểm Danh LH-TECH vào thiết bị!', 'success');
    }
  });

  // 4. Cập nhật Logo LH-TECH đẹp mắt trên trang Đăng nhập
  function enhanceLoginBrand() {
    const brandContainer = document.querySelector('.w-14.h-14.rounded-2xl.bg-gradient-to-tr');
    if (brandContainer && !brandContainer.querySelector('img')) {
      brandContainer.className = 'w-16 h-16 rounded-2xl mx-auto flex items-center justify-center shadow-xl shadow-amber-500/20 mb-3 border border-amber-400/40 p-0.5 bg-slate-900 overflow-hidden';
      brandContainer.innerHTML = '<img src="icons/icon-192.png" alt="LH-TECH Logo" class="w-full h-full object-cover rounded-[14px]" />';
    }
  }

  // 5. Hiển thị Modal hướng dẫn cho iOS Safari hoặc trình duyệt khác
  function showIosInstallModal() {
    let modal = document.getElementById('pwaIosModal');
    if (modal) {
      modal.classList.remove('hidden');
      return;
    }

    modal = document.createElement('div');
    modal.id = 'pwaIosModal';
    modal.className = 'fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md transition-all duration-200';
    modal.innerHTML = `
      <div class="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-sm p-6 shadow-2xl relative space-y-4">
        <div class="flex items-center justify-between border-b border-slate-800 pb-3">
          <div class="flex items-center gap-3">
            <img src="icons/icon-192.png" alt="LH-TECH Logo" class="w-10 h-10 rounded-xl object-cover border border-amber-400/50 shadow-md shrink-0" />
            <div>
              <h3 class="text-sm font-bold text-white leading-snug">Cài Đặt App LH-TECH</h3>
              <p class="text-[11px] text-slate-400">Thêm vào Màn hình chính</p>
            </div>
          </div>
          <button type="button" onclick="document.getElementById('pwaIosModal').classList.add('hidden')" class="text-slate-400 hover:text-white p-1 rounded-lg">
            <i class="fa-solid fa-xmark text-base"></i>
          </button>
        </div>

        <div class="space-y-3 text-xs text-slate-300">
          <div class="flex items-start gap-2.5 bg-slate-950/60 p-2.5 rounded-xl border border-slate-800">
            <span class="w-6 h-6 rounded-lg bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold text-xs shrink-0">1</span>
            <p class="leading-relaxed">Bấm nút <strong class="text-white">Chia sẻ</strong> (<i class="fa-solid fa-arrow-up-from-bracket text-blue-400 mx-1"></i>) ở thanh công cụ dưới đáy trình duyệt.</p>
          </div>
          <div class="flex items-start gap-2.5 bg-slate-950/60 p-2.5 rounded-xl border border-slate-800">
            <span class="w-6 h-6 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-xs shrink-0">2</span>
            <p class="leading-relaxed">Cuộn xuống và chọn mục <strong class="text-emerald-400">"Thêm vào MH chính"</strong> (<i class="fa-regular fa-square-plus text-emerald-400 mx-1"></i> Add to Home Screen).</p>
          </div>
          <div class="flex items-start gap-2.5 bg-slate-950/60 p-2.5 rounded-xl border border-slate-800">
            <span class="w-6 h-6 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold text-xs shrink-0">3</span>
            <p class="leading-relaxed">Nhấn <strong class="text-white">"Thêm" (Add)</strong> ở góc trên bên phải để tạo biểu tượng App ngoài màn hình.</p>
          </div>
        </div>

        <button type="button" onclick="document.getElementById('pwaIosModal').classList.add('hidden')" class="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition shadow-lg shadow-emerald-600/20">
          Đã Hiểu
        </button>
      </div>
    `;
    document.body.appendChild(modal);
  }

  // 6. Xử lý khi nhấn nút Cài đặt
  async function triggerInstall() {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice && choice.outcome === 'accepted') {
        removeInstallBanner();
        deferredPrompt = null;
      }
      return;
    }
    // Nếu là iOS hoặc trình duyệt chưa hỗ trợ prompt trực tiếp
    showIosInstallModal();
  }

  // 7. Xóa Banner
  function removeInstallBanner() {
    const banner = document.getElementById('pwaInstallBanner');
    if (banner) banner.remove();
  }

  // 8. Render Banner Cài Đặt Nổi Bật (Fixed Bottom)
  function renderInstallBanner() {
    if (isStandalone || bannerDismissed || document.getElementById('pwaInstallBanner')) return;

    const banner = document.createElement('aside');
    banner.id = 'pwaInstallBanner';
    banner.className = 'fixed bottom-4 left-4 right-4 max-w-md mx-auto z-40 bg-slate-900/95 border border-emerald-500/40 rounded-2xl p-3 sm:p-3.5 shadow-2xl backdrop-blur-xl flex items-center justify-between gap-3 transition-all animate-bounce-short';
    banner.innerHTML = `
      <div class="flex items-center gap-3 min-w-0">
        <img src="icons/icon-192.png" alt="LH-TECH Logo" class="w-10 h-10 rounded-xl object-cover border border-amber-400/50 shadow-md shrink-0" />
        <div class="min-w-0">
          <h4 class="text-xs sm:text-sm font-bold text-white leading-tight truncate">Cài Đặt App LH-TECH</h4>
          <p class="text-[10px] sm:text-[11px] text-slate-400 truncate mt-0.5">Quét QR 1 chạm • Mở nhanh trên MH chính</p>
        </div>
      </div>
      <div class="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          id="btnDoInstallPwa"
          class="px-3 py-1.5 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 active:scale-95 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 shadow-lg shadow-emerald-500/25 transition cursor-pointer"
        >
          <i class="fa-solid fa-cloud-arrow-down text-xs"></i>
          <span>Cài Đặt</span>
        </button>
        <button
          type="button"
          id="btnDismissPwaBanner"
          class="w-7 h-7 rounded-xl text-slate-500 hover:text-slate-300 flex items-center justify-center transition"
          title="Đóng thông báo"
        >
          <i class="fa-solid fa-xmark text-xs"></i>
        </button>
      </div>
    `;

    document.body.appendChild(banner);

    const btnInstall = document.getElementById('btnDoInstallPwa');
    if (btnInstall) btnInstall.addEventListener('click', triggerInstall);

    const btnDismiss = document.getElementById('btnDismissPwaBanner');
    if (btnDismiss) {
      btnDismiss.addEventListener('click', () => {
        bannerDismissed = true;
        sessionStorage.setItem('pwa_banner_dismissed', 'true');
        removeInstallBanner();
      });
    }
  }

  // 9. Nút "Cài App" nhỏ gọn trên thanh điều khiển Scanner (checkin.html)
  function injectScannerInstallPill() {
    if (isStandalone) return;
    const scannerScreen = document.getElementById('scannerScreen');
    if (!scannerScreen || document.getElementById('btnScannerPwaPill')) return;

    const headerCard = scannerScreen.querySelector('.bg-slate-900.border.border-slate-800');
    if (headerCard && !document.getElementById('btnScannerPwaPill')) {
      const pillWrap = document.createElement('div');
      pillWrap.id = 'btnScannerPwaPillWrap';
      pillWrap.className = 'mt-2.5 pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs';
      pillWrap.innerHTML = `
        <div class="flex items-center gap-2">
          <img src="icons/icon-192.png" alt="LH-TECH" class="w-5 h-5 rounded-md object-cover border border-amber-400/40" />
          <span class="text-[11px] text-slate-300 font-medium">Chưa cài app vào màn hình chính?</span>
        </div>
        <button
          type="button"
          id="btnScannerPwaPill"
          class="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 transition flex items-center gap-1 active:scale-95 cursor-pointer"
        >
          <i class="fa-solid fa-cloud-arrow-down text-[10px]"></i> Cài Đặt App
        </button>
      `;
      headerCard.appendChild(pillWrap);

      const btnPill = document.getElementById('btnScannerPwaPill');
      if (btnPill) btnPill.addEventListener('click', triggerInstall);
    }
  }

  // ==============================================================
  // 10. WEB PUSH NOTIFICATION CONTROLLER (PWA)
  // ==============================================================
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  function isPushSupported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }

  let currentStudentIdentity = null;

  async function resolveStudentIdentity() {
    if (currentStudentIdentity?.profile?.student_id) return currentStudentIdentity;
    if (!root.Attendance?.identity) return null;
    try {
      const id = await root.Attendance.identity();
      if (id?.profile?.student_id) {
        currentStudentIdentity = id;
        return id;
      }
    } catch (e) {}
    return null;
  }

  async function syncPushSubscription(interactive = false) {
    if (!isPushSupported()) {
      if (interactive) {
        if (isIos && !isStandalone) {
          showIosInstallModal();
          root.showToast?.warning('Trên iPhone, vui lòng "Thêm vào MH chính" trước để nhận thông báo đẩy.');
        } else {
          root.showToast?.warning('Trình duyệt hiện tại chưa hỗ trợ Web Push Notification.');
        }
      }
      return { subscribed: false };
    }

    const identity = await resolveStudentIdentity();
    if (!identity?.profile?.student_id) {
      if (interactive) root.showToast?.warning('Vui lòng đăng nhập tài khoản sinh viên trước khi bật thông báo.');
      return { subscribed: false };
    }

    let permission = Notification.permission;
    if (permission !== 'granted') {
      if (!interactive) return { subscribed: false, permission };
      permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        root.showToast?.warning('Bạn đã từ chối quyền thông báo. Hãy bật lại trong cài đặt trình duyệt.');
        updatePushCardUI(false, permission);
        return { subscribed: false, permission };
      }
    }

    const vapidKey = root.ATTENDANCE_CONFIG?.vapidPublicKey;
    if (!vapidKey) {
      if (interactive) root.showToast?.error('Chưa cấu hình khóa VAPID.');
      return { subscribed: false };
    }

    try {
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey)
        });
      }

      const subJson = sub.toJSON();
      const endpoint = subJson.endpoint;
      const p256dh = subJson.keys?.p256dh;
      const auth = subJson.keys?.auth;

      if (endpoint && p256dh && auth && root.Attendance?.client) {
        const { error } = await root.Attendance.client
          .from('push_subscriptions')
          .upsert({
            endpoint,
            profile_id: identity.profile.id,
            student_id: identity.profile.student_id,
            p256dh,
            auth,
            user_agent: navigator.userAgent.slice(0, 250),
            updated_at: new Date().toISOString()
          }, { onConflict: 'endpoint' });

        if (error) throw error;
      }

      updatePushCardUI(true, 'granted');
      if (interactive) {
        root.showToast?.success('🔔 Đã bật thông báo điện thoại thành công!');
      }
      return { subscribed: true, permission: 'granted' };
    } catch (err) {
      console.warn('[Push] Lỗi đăng ký Web Push:', err);
      if (interactive) {
        root.showToast?.error('Không thể đăng ký thông báo: ' + (err.message || 'Lỗi kết nối'));
      }
      return { subscribed: false, error: err.message };
    }
  }

  async function handleTestPushNotification() {
    const btn = document.getElementById('btnTestWebPush');
    const identity = await resolveStudentIdentity();
    if (!identity?.profile?.student_id) {
      root.showToast?.warning('Chưa xác định được tài khoản sinh viên.');
      return;
    }
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-[10px]"></i> Đang gửi...';
    }
    try {
      await syncPushSubscription(false);
      const supabaseUrl = root.ATTENDANCE_CONFIG?.supabaseUrl;
      const res = await fetch(`${supabaseUrl}/functions/v1/web-push-worker`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'test_push',
          student_id: identity.profile.student_id
        })
      });
      const data = await res.json();
      if (data.success && data.sent_count > 0) {
        root.showToast?.success('🔔 Đã gửi thông báo thử! Hãy kiểm tra thanh thông báo điện thoại.');
      } else {
        root.showToast?.warning(data.message || 'Chưa gửi được thông báo thử. Hãy bấm Bật lại thông báo.');
      }
    } catch (err) {
      root.showToast?.error('Lỗi khi gửi thông báo thử.');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-paper-plane text-[10px]"></i> Gửi thử';
      }
    }
  }

  function updatePushCardUI(isSubscribed, permission) {
    const statusBadge = document.getElementById('pwaPushStatusBadge');
    const descText = document.getElementById('pwaPushDescText');
    const actionWrap = document.getElementById('pwaPushActionWrap');
    if (!statusBadge || !descText || !actionWrap) return;

    if (isSubscribed && permission === 'granted') {
      statusBadge.className = 'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30';
      statusBadge.innerHTML = '<i class="fa-solid fa-circle-check text-[9px]"></i> Đã bật';
      descText.textContent = 'Điện thoại sẽ tự động nhận thông báo kết quả duyệt đơn xin trễ/nghỉ và nhắc nhở 15 phút trước giờ vào ca.';
      actionWrap.innerHTML = `
        <button
          type="button"
          id="btnTestWebPush"
          class="px-2.5 py-1.5 rounded-xl text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 transition flex items-center gap-1.5 active:scale-95 cursor-pointer shrink-0"
        >
          <i class="fa-solid fa-paper-plane text-[10px]"></i> Gửi thử
        </button>
      `;
      document.getElementById('btnTestWebPush')?.addEventListener('click', handleTestPushNotification);
    } else if (permission === 'denied') {
      statusBadge.className = 'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/15 text-rose-400 border border-rose-500/30';
      statusBadge.innerHTML = '<i class="fa-solid fa-bell-slash text-[9px]"></i> Đã chặn';
      descText.textContent = 'Quyền thông báo đang bị tắt trên thiết bị. Nhấn "Cấp lại quyền" để mở khóa nhận thông báo duyệt đơn & nhắc ca.';
      actionWrap.innerHTML = `
        <button
          type="button"
          id="btnUnblockWebPush"
          class="px-3 py-1.5 rounded-xl text-[11px] font-bold bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 transition flex items-center gap-1.5 active:scale-95 cursor-pointer shrink-0"
        >
          <i class="fa-solid fa-unlock-keyhole text-[10px]"></i> Cấp lại quyền
        </button>
      `;
      document.getElementById('btnUnblockWebPush')?.addEventListener('click', () => void handleUnblockPushPermission());
    } else {
      statusBadge.className = 'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30';
      statusBadge.innerHTML = '<i class="fa-solid fa-bell text-[9px]"></i> Chưa bật';
      descText.textContent = (isIos && !isStandalone)
        ? 'Trên iPhone: Hãy bấm "Cài Đặt App" (Thêm vào MH chính) rồi mở App để bật thông báo duyệt đơn & nhắc giờ vào ca.'
        : 'Bật thông báo để nhận kết quả khi Admin duyệt/từ chối đơn xin trễ, vắng và nhắc nhở trước giờ vào ca.';
      actionWrap.innerHTML = `
        <button
          type="button"
          id="btnEnableWebPush"
          class="px-3 py-1.5 rounded-xl text-[11px] font-bold bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white shadow-md shadow-amber-500/20 transition flex items-center gap-1.5 active:scale-95 cursor-pointer shrink-0"
        >
          <i class="fa-solid fa-bell text-[10px]"></i> Bật thông báo
        </button>
      `;
      document.getElementById('btnEnableWebPush')?.addEventListener('click', () => void syncPushSubscription(true));
    }
  }

  // Xử lý khi người dùng bấm "Cấp lại quyền" lúc đang ở trạng thái Đã chặn (denied)
  async function handleUnblockPushPermission() {
    if (isPushSupported()) {
      try {
        const perm = await Notification.requestPermission();
        if (perm === 'granted') {
          await syncPushSubscription(true);
          return;
        }
      } catch (e) {}
    }
    showUnblockPermissionModal();
  }

  // Modal hướng dẫn mở khóa quyền thông báo nhanh khi trình duyệt đã chặn
  function showUnblockPermissionModal() {
    let modal = document.getElementById('pwaUnblockPushModal');
    if (modal) {
      modal.classList.remove('hidden');
      return;
    }

    modal = document.createElement('div');
    modal.id = 'pwaUnblockPushModal';
    modal.className = 'fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md transition-all duration-200';
    modal.innerHTML = `
      <div class="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-sm p-5 shadow-2xl relative space-y-4">
        <div class="flex items-center justify-between border-b border-slate-800 pb-3">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
              <i class="fa-solid fa-bell text-lg"></i>
            </div>
            <div>
              <h3 class="text-sm font-bold text-white leading-snug">Mở Khóa Quyền Thông Báo</h3>
              <p class="text-[11px] text-slate-400">Chỉ mất 5 giây để bật lại trên điện thoại</p>
            </div>
          </div>
          <button type="button" onclick="document.getElementById('pwaUnblockPushModal').classList.add('hidden')" class="text-slate-400 hover:text-white p-1.5 rounded-lg cursor-pointer">
            <i class="fa-solid fa-xmark text-base"></i>
          </button>
        </div>

        <div class="space-y-2.5 text-xs text-slate-300">
          <div class="bg-slate-950/70 p-3 rounded-2xl border border-slate-800 space-y-1.5">
            <p class="font-bold text-emerald-400 flex items-center gap-1.5">
              <i class="fa-solid fa-mobile-screen-button"></i> Cách 1: Nếu đang mở từ App ngoài Màn hình chính
            </p>
            <p class="text-[11px] text-slate-300 leading-relaxed">
              1. Ra màn hình chính điện thoại, <strong>nhấn giữ biểu tượng App Điểm Danh QR</strong>.<br>
              2. Chọn <strong>Thông tin ứng dụng ( biểu tượng <i class="fa-solid fa-circle-info text-blue-400"></i> )</strong> &rarr; <strong>Thông báo</strong>.<br>
              3. Gạt bật <strong>"Cho phép thông báo"</strong>.
            </p>
          </div>

          <div class="bg-slate-950/70 p-3 rounded-2xl border border-slate-800 space-y-1.5">
            <p class="font-bold text-amber-400 flex items-center gap-1.5">
              <i class="fa-brands fa-chrome"></i> Cách 2: Nếu đang mở trên trình duyệt Chrome / Safari
            </p>
            <p class="text-[11px] text-slate-300 leading-relaxed">
              1. Bấm vào biểu tượng <strong>Cài đặt / Ổ khóa (<i class="fa-solid fa-sliders text-amber-400 mx-0.5"></i>)</strong> bên trái thanh địa chỉ web.<br>
              2. Chọn <strong>Quyền (Permissions)</strong> &rarr; <strong>Thông báo</strong>.<br>
              3. Chọn <strong>"Cho phép" (Allow)</strong> hoặc bấm <strong>Đặt lại quyền</strong>.
            </p>
          </div>
        </div>

        <div class="flex items-center gap-2 pt-1">
          <button
            type="button"
            onclick="document.getElementById('pwaUnblockPushModal').classList.add('hidden')"
            class="py-2.5 px-3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition cursor-pointer"
          >
            Đóng
          </button>
          <button
            type="button"
            id="btnRecheckPushPermission"
            class="flex-1 py-2.5 px-3 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-white rounded-xl text-xs font-bold transition shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <i class="fa-solid fa-rotate text-xs"></i>
            <span>Đã bật xong • Kiểm tra ngay</span>
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('btnRecheckPushPermission')?.addEventListener('click', async () => {
      modal.classList.add('hidden');
      if (Notification.permission === 'granted') {
        await syncPushSubscription(true);
      } else if (Notification.permission === 'default') {
        await syncPushSubscription(true);
      } else {
        window.location.reload();
      }
    });
  }

  // Modal tự động mời bật thông báo khi sinh viên vào App (nếu trạng thái là 'default')
  function showAutoPushPromptModal() {
    if (!isPushSupported()) return;
    if (Notification.permission !== 'default') return;
    if (sessionStorage.getItem('pwa_push_prompt_shown') === 'true') return;
    if (document.getElementById('pwaAutoPushPromptModal')) return;

    sessionStorage.setItem('pwa_push_prompt_shown', 'true');

    const modal = document.createElement('div');
    modal.id = 'pwaAutoPushPromptModal';
    modal.className = 'fixed inset-0 z-[99998] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md transition-all duration-200';
    modal.innerHTML = `
      <div class="bg-slate-900 border border-amber-500/30 rounded-3xl w-full max-w-sm p-5 shadow-2xl relative space-y-4 text-center">
        <div class="w-14 h-14 rounded-2xl bg-gradient-to-tr from-amber-500 to-orange-400 mx-auto flex items-center justify-center text-white shadow-xl shadow-amber-500/25">
          <i class="fa-solid fa-bell text-2xl animate-bounce"></i>
        </div>
        <div class="space-y-1.5">
          <h3 class="text-base font-extrabold text-white">Bật Thông Báo Điểm Danh</h3>
          <p class="text-xs text-slate-300 leading-relaxed">
            Cho phép ứng dụng gửi thông báo để nhận ngay kết quả khi <strong>Admin duyệt đơn xin trễ / nghỉ phép</strong> và <strong>nhắc nhở 15 phút trước giờ vào ca</strong>.
          </p>
        </div>
        <div class="flex items-center gap-2 pt-1">
          <button
            type="button"
            id="btnSkipAutoPushPrompt"
            class="py-2.5 px-3.5 bg-slate-800 hover:bg-slate-700 text-slate-400 rounded-xl text-xs font-semibold transition cursor-pointer"
          >
            Để sau
          </button>
          <button
            type="button"
            id="btnAcceptAutoPushPrompt"
            class="flex-1 py-2.5 px-4 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white rounded-xl text-xs font-bold transition shadow-lg shadow-amber-500/25 flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <i class="fa-solid fa-circle-check text-xs"></i>
            <span>Cho Phép Thông Báo</span>
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('btnSkipAutoPushPrompt')?.addEventListener('click', () => {
      modal.remove();
    });
    document.getElementById('btnAcceptAutoPushPrompt')?.addEventListener('click', async () => {
      modal.remove();
      await syncPushSubscription(true);
    });
  }

  async function injectPushNotificationCard() {
    const leaveSection = document.getElementById('myLeaveRequestsSection');
    if (!leaveSection || document.getElementById('pwaPushNotificationSection')) return;

    const section = document.createElement('section');
    section.id = 'pwaPushNotificationSection';
    section.className = 'mt-3 bg-slate-900 border border-slate-800 rounded-2xl p-3.5 space-y-2';
    section.innerHTML = `
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2 min-w-0">
          <div class="w-7 h-7 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
            <i class="fa-solid fa-bell text-xs"></i>
          </div>
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <h3 class="text-xs font-bold text-white truncate">Thông báo nhắc ca &amp; duyệt đơn</h3>
              <span id="pwaPushStatusBadge" class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-slate-400">...</span>
            </div>
          </div>
        </div>
        <div id="pwaPushActionWrap"></div>
      </div>
      <p id="pwaPushDescText" class="text-[11px] text-slate-400 leading-relaxed"></p>
    `;

    leaveSection.parentNode.insertBefore(section, leaveSection);

    if (!isPushSupported()) {
      updatePushCardUI(false, 'default');
      return;
    }

    const perm = Notification.permission;
    if (perm === 'granted') {
      const res = await syncPushSubscription(false);
      updatePushCardUI(res.subscribed, perm);
    } else {
      updatePushCardUI(false, perm);
      if (perm === 'default') {
        setTimeout(showAutoPushPromptModal, 800);
      }
    }

    // Tự động nhận diện ngay khi người dùng vừa bật quyền từ Cài đặt điện thoại quay lại App
    if (navigator.permissions && typeof navigator.permissions.query === 'function') {
      navigator.permissions.query({ name: 'notifications' }).then((permStatus) => {
        permStatus.onchange = async () => {
          const currentPerm = Notification.permission;
          const unblockModal = document.getElementById('pwaUnblockPushModal');
          if (currentPerm === 'granted') {
            if (unblockModal) unblockModal.classList.add('hidden');
            await syncPushSubscription(true);
          } else {
            updatePushCardUI(false, currentPerm);
          }
        };
      }).catch(() => {});
    }

    document.addEventListener('visibilitychange', async () => {
      if (!document.hidden && isPushSupported()) {
        const currentPerm = Notification.permission;
        if (currentPerm === 'granted') {
          const unblockModal = document.getElementById('pwaUnblockPushModal');
          if (unblockModal) unblockModal.classList.add('hidden');
          const res = await syncPushSubscription(false);
          updatePushCardUI(res.subscribed, currentPerm);
        } else {
          updatePushCardUI(false, currentPerm);
        }
      }
    });
  }

  // 11. Khởi tạo
  function init() {
    enhanceLoginBrand();
    if (!isStandalone) {
      setTimeout(renderInstallBanner, 1000);
      setTimeout(injectScannerInstallPill, 1200);
    }
    setTimeout(() => void injectPushNotificationCard(), 1300);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  root.triggerPwaInstall = triggerInstall;
})(globalThis);
