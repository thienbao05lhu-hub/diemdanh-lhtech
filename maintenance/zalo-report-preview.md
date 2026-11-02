# Báo cáo Zalo: bước chuẩn bị dữ liệu

SQL 180 bổ sung `admin_preview_zalo_report(date, shift, type)` cho Admin đang hoạt động. Đây là bản xem trước, `deliveryEnabled=false`; chưa có worker gửi tin, token, người nhận hoặc Cron Zalo mới. Nút Zalo và giao diện giữ nguyên, chức năng gửi vẫn tạm dừng.

Nguồn SQL: [prepare-zalo-report-preview.sql](prepare-zalo-report-preview.sql). Kiểm tra quyền bằng [check-zalo-report-preview.sql](check-zalo-report-preview.sql). Chủ dự án không cần chạy lại nếu bản này đã được triển khai.

## Vì sao lịch LHU chưa khớp bảng hôm nay khi thử?

- Lịch LHU đã áp dụng ghi vào lịch tuần thật.
- Khi QR thử đang hoạt động, bảng hôm nay đọc lượt thử riêng và liệt kê sinh viên để kiểm tra camera/thiết bị. Nó không lấy danh sách phải lên xưởng từ lịch LHU.
- Khi dùng ca thật: chưa mở ca thì danh sách dự kiến lấy lịch tuần; sau khi mở ca, danh sách được chụp lại một lần. Đồng bộ lịch sau đó không sửa ngược danh sách ca đã mở hoặc các lượt điểm danh.
- Dùng [check-lhu-attendance-link.sql](check-lhu-attendance-link.sql) để đối chiếu số lượng. Khác biệt giữa lịch mới và snapshot cũ không tự động là lỗi.

Ngày 02/11/2026 đã xác minh Supabase có 23 lịch nguồn LHU, chế độ thử QR còn hoạt động và automation thật đang tắt. Không tắt trial hoặc sửa snapshot chỉ để làm các bảng giống nhau.

## Quy tắc báo cáo

- Chỉ Admin/Super Admin đang hoạt động được xem; sinh viên và người chưa đăng nhập bị chặn.
- Trial còn được cấu hình bật thì báo `TEST_MODE`, kể cả đã hết 24 giờ. Cần tắt trial rõ ràng trước khi dùng báo cáo thật.
- Báo cáo dùng RPC điểm danh thật và snapshot ca, không truy vấn lịch tuần lại để suy đoán người vắng.
- Chỉ tính hồ sơ có vai trò sinh viên. Người ngoài lịch đã quét vẫn được tính; người không có lịch và không quét không bị tính vắng.
- `early`: từ 08:31 / 13:31 / 18:31 đến trước giờ kết thúc ca đang mở; người chưa quét là “Chưa điểm danh”.
- `closing`: yêu cầu `finalized_at` và `closed_at`, không chỉ dựa vào giờ trên đồng hồ. Ca chưa chốt hoặc dữ liệu thiếu không tạo nội dung để gửi.
- Nội dung không chứa lý do xin nghỉ, email, thông tin thiết bị hoặc token. Bản xem trước không ghi điểm danh/audit và không gọi mạng.

## Các bước tiếp theo

1. Kiểm thử chuyển từ QR thử sang ca thật: đối chiếu lịch LHU đã áp dụng, snapshot mở ca, bảng hôm nay, xin nghỉ và chốt ca. Việc chuyển chế độ thực hiện khi chủ dự án kết thúc thử; không mở lại/chỉnh snapshot ca cũ.
2. Chuẩn bị hàng đợi gửi, chống gửi trùng và xử lý trường hợp Zalo không xác nhận kết quả; cấu hình Bot token/người nhận ở backend. Không dùng script GitHub Actions cũ đọc bảng bằng khóa công khai.
3. Nối nút Zalo hiện có với worker đã kiểm chứng. Chỉ bật gửi thật sau khi xác nhận đúng người nhận và nội dung; chưa gửi tin trong bước chuẩn bị này.

Thiết kế quyền RPC theo [Supabase Database Functions](https://supabase.com/docs/guides/database/functions): wrapper public INVOKER, kiểm tra vai trò trong hàm private, không cấp ghi bảng cho trình duyệt.

Triển khai 02/11/2026: SQL 180 đã chạy trên Supabase thật. Gọi bằng ngữ cảnh Admin trả `TEST_MODE`, `deliveryEnabled=false` đúng trạng thái đang thử; kiểm tra ACL đúng ở cả hai schema. 188/188 kiểm thử cục bộ đạt, gồm luồng lịch → snapshot → báo cáo/chốt ca và chuẩn giao diện tối. Chưa gửi tin Zalo.
