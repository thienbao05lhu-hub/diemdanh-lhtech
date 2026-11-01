/* Thành phần hiển thị gốc: giữ nguyên CSS/bố cục, dữ liệu chỉ ghi dạng text. */
(function(root) {
  'use strict';
    function playBeep(success = true) {
      try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);

        if (success) {
          osc.frequency.setValueAtTime(880, audioCtx.currentTime); // Âm cao A5
          osc.frequency.setValueAtTime(1200, audioCtx.currentTime + 0.08); // Nhảy nốt vui tai
          gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.25);
          osc.start();
          osc.stop(audioCtx.currentTime + 0.25);
        } else {
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(220, audioCtx.currentTime); // Âm trầm báo lỗi
          gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.35);
          osc.start();
          osc.stop(audioCtx.currentTime + 0.35);
        }
      } catch (e) {
        // Trình duyệt chặn autoplay audio nếu chưa chạm màn hình
      }
    }

    function showScanResult(status, title, message) {
      const alertDiv = document.getElementById('scanAlert');
      const iconDiv = document.getElementById('scanAlertIcon');
      const titleDiv = document.getElementById('scanAlertTitle');
      const msgDiv = document.getElementById('scanAlertMessage');

      alertDiv.className = 'mt-3.5 p-4 sm:p-5 rounded-2xl border transition-all duration-300 shadow-2xl flex flex-col gap-3.5';

      if (status === 'loading') {
        alertDiv.classList.add('bg-blue-950/60', 'border-blue-500/40');
        iconDiv.className = 'w-10 h-10 rounded-xl bg-blue-500/15 text-blue-400 border border-blue-500/30 flex items-center justify-center text-lg shrink-0';
        iconDiv.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-blue-400"></i>';
        titleDiv.className = 'text-sm sm:text-base font-bold text-blue-300 leading-snug';
      } else if (status === true) {
        alertDiv.classList.add('bg-emerald-950/60', 'border-emerald-500/40');
        iconDiv.className = 'w-10 h-10 rounded-xl bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center justify-center text-xl shrink-0 shadow-lg shadow-emerald-500/10';
        iconDiv.innerHTML = '<i class="fa-solid fa-circle-check text-emerald-400"></i>';
        titleDiv.className = 'text-sm sm:text-base font-bold text-emerald-300 leading-snug';
      } else if (status === 'warning') {
        alertDiv.classList.add('bg-amber-950/60', 'border-amber-500/50');
        iconDiv.className = 'w-10 h-10 rounded-xl bg-amber-500/15 text-amber-400 border border-amber-500/30 flex items-center justify-center text-xl shrink-0 shadow-lg shadow-amber-500/10';
        iconDiv.innerHTML = '<i class="fa-solid fa-triangle-exclamation text-amber-400"></i>';
        titleDiv.className = 'text-sm sm:text-base font-bold text-amber-300 leading-snug';
      } else {
        alertDiv.classList.add('bg-rose-950/60', 'border-rose-500/40');
        iconDiv.className = 'w-10 h-10 rounded-xl bg-rose-500/15 text-rose-400 border border-rose-500/30 flex items-center justify-center text-xl shrink-0 shadow-lg shadow-rose-500/10';
        iconDiv.innerHTML = '<i class="fa-solid fa-circle-xmark text-rose-400"></i>';
        titleDiv.className = 'text-sm sm:text-base font-bold text-rose-300 leading-snug';
      }

      msgDiv.className = 'text-xs sm:text-sm text-slate-200 mt-1 leading-relaxed break-words';
      titleDiv.innerText = title;
      msgDiv.innerText = message;
      alertDiv.classList.remove('hidden');


    }


  function showToast(message, type = 'info', duration = 3500) {
    const colors = { success: 'border-emerald-500/40 text-emerald-400 bg-slate-900/95', error: 'border-rose-500/40 text-rose-400 bg-slate-900/95', warning: 'border-amber-500/40 text-amber-400 bg-slate-900/95', info: 'border-blue-500/40 text-blue-400 bg-slate-900/95' };
    const icons = { success: 'fa-circle-check', error: 'fa-circle-xmark', warning: 'fa-triangle-exclamation', info: 'fa-circle-info' };
    const toast = document.createElement('div');
    toast.className = `toast-enter pointer-events-auto rounded-2xl p-3.5 border shadow-2xl backdrop-blur-md flex items-center gap-3 ${colors[type] || colors.info}`;
    const icon = document.createElement('i'); icon.className = `fa-solid ${icons[type] || icons.info} text-base shrink-0`;
    const text = document.createElement('p'); text.className = 'text-xs text-white flex-1 leading-snug'; text.textContent = String(message || '');
    toast.append(icon, text); document.getElementById('toastContainer').append(toast);
    setTimeout(() => { toast.classList.remove('toast-enter'); toast.classList.add('toast-exit'); setTimeout(() => toast.remove(), 260); }, duration);
  }
  for (const type of ['success','error','warning']) showToast[type] = message => showToast(message, type);
  root.showToast = showToast; root.showScanResult = showScanResult; root.playBeep = playBeep;
})(globalThis);
