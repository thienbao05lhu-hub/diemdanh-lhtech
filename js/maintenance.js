(function () {
  'use strict';
  let qr = null, leaves = null;
  function update() {
    show();
    const qrText = qr === true ? 'QR và mở khóa thiết bị đã bật.' : qr === false ? 'QR đang tạm dừng.' : 'Đang kiểm tra quyền QR.';
    const leaveText = leaves === true ? 'Xin nghỉ và xét duyệt đã bật.' : leaves === false ? 'Xin nghỉ và xét duyệt đang tạm dừng.' : 'Đang kiểm tra quyền xử lý đơn nghỉ.';
    document.getElementById('security-maintenance').textContent = `${qrText} ${leaveText} Sửa điểm danh thủ công, đồng bộ LHU và Zalo vẫn tạm dừng. Chốt ca chưa tự tạo vắng cho người chưa quét.`;
  }
  function show() {
    if (document.getElementById('security-maintenance')) return;
    const banner = document.createElement('aside');
    banner.id = 'security-maintenance'; banner.setAttribute('role','status');
    banner.style.cssText = 'padding:12px 20px;background:#fff3cd;color:#513c06;border-bottom:1px solid #e8ce7f;font:14px/1.5 system-ui;position:relative;z-index:50;';
    banner.textContent = 'Hệ thống đang khôi phục từng chức năng sau cập nhật bảo mật. Trạng thái sử dụng được xác nhận tại từng trang. Sửa điểm danh thủ công, đồng bộ LHU và Zalo vẫn tạm dừng.';
    document.body.prepend(banner);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',show,{once:true}); else show();
  window.addEventListener('attendance-capability', function (event) {
    qr = event.detail?.qrEnabled === true; update();
  });
  window.addEventListener('leave-capability', function (event) { leaves = event.detail?.leaveEnabled === true; update(); });
})();
