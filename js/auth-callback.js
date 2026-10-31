(function () {
  'use strict';
  // Chạy trước khi khởi tạo SDK ở trang đăng nhập. Link từ email có thể trỏ về Site URL.
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  if (!fragment.has('access_token') && !fragment.has('error') && !fragment.has('error_code')) return;
  window.AttendanceRedirecting = true;
  const target = new URL('reset-password.html', window.location.href);
  target.hash = window.location.hash;
  window.location.replace(target.href);
})();
