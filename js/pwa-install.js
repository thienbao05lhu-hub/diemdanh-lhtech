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

  // 10. Khởi tạo
  function init() {
    enhanceLoginBrand();
    if (!isStandalone) {
      setTimeout(renderInstallBanner, 1000);
      setTimeout(injectScannerInstallPill, 1200);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  root.triggerPwaInstall = triggerInstall;
})(globalThis);
