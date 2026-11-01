/* Định dạng CSV dùng cho các nút xuất có sẵn; không thêm UI. */
(function (root) {
  'use strict';
  function cell(value) {
    let text = String(value ?? '');
    // Quoting không ngăn bảng tính thực thi công thức; thêm dấu nháy đơn vào ô nguy hiểm.
    if (/^[\s\u0000-\u001f\u007f]*[=+@-]/u.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }
  function attendance(records, fallbackShift = '') {
    const header = ['STT','Mã Sinh Viên','Họ Và Tên','Lớp / Khoa','Ca Làm Việc','Thời Gian Điểm Danh','Trạng Thái','Ghi Chú'];
    const rows = records.map((item,index) => {
      const stamp = item.timestamp ? new Date(item.timestamp) : null;
      const scanned = ['Có mặt','Đi trễ'].includes(item.status) && stamp && Number.isFinite(stamp.getTime());
      const time = scanned ? stamp.toLocaleString('vi-VN', { timeZone:'Asia/Ho_Chi_Minh',
        hour:'2-digit',minute:'2-digit',second:'2-digit',day:'2-digit',month:'2-digit',year:'numeric' }) : 'Chưa quét';
      return [index+1,item.userId,item.userName,item.department,`Ca ${item.shift || fallbackShift}`,time,
        item.status || 'Chưa điểm danh',item.note || (item.inSchedule ? 'Trong lịch' : 'Ngoài lịch')];
    });
    return [header,...rows].map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
  }
  root.AttendanceCsv = Object.freeze({ cell, attendance });
})(globalThis);
