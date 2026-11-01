(function () {
  'use strict';
  function show() {
    if (document.getElementById('security-maintenance')) return;
    const banner = document.createElement('aside');
    banner.id = 'security-maintenance'; banner.setAttribute('role','status');
    banner.style.cssText = 'padding:12px 20px;background:#fff3cd;color:#513c06;border-bottom:1px solid #e8ce7f;font:14px/1.5 system-ui;position:relative;z-index:50;';
    banner.textContent = 'Đang giới hạn ghi để cập nhật bảo mật. Điểm danh, duyệt nghỉ, chỉnh sửa trên dashboard, đồng bộ LHU và gửi Zalo tạm dừng. Các bảng chỉ hiển thị dữ liệu đã lưu; thao tác bị từ chối sẽ không được tính là thành công.';
    document.body.prepend(banner);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',show,{once:true}); else show();
  window.addEventListener('attendance-capability', function (event) {
    show();
    document.getElementById('security-maintenance').textContent = event.detail?.qrEnabled === true
      ? 'Điểm danh QR và mở khóa thiết bị đã được bật qua kiểm tra quyền tại server. Duyệt nghỉ, sửa điểm danh, đồng bộ LHU và gửi Zalo vẫn tạm dừng. Chốt ca sẽ khóa bản ghi hiện có; chưa tự tạo vắng cho người chưa quét.'
      : 'Đang giới hạn ghi để cập nhật bảo mật. Điểm danh, duyệt nghỉ, chỉnh sửa trên dashboard, đồng bộ LHU và gửi Zalo tạm dừng.';
  });
})();
