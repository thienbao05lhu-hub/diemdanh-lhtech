# Hàng đợi Zalo — đã chuẩn bị, gửi thật đang tắt

## Cập nhật mới nhất — nút cũ và Cron đã nối

Bot cũ và nơi nhận cũ đã được chủ dự án xác nhận; token mới/khóa worker lưu trong Vault. Đã triển khai SQL 186 và Cron `lhtech-zalo-delivery-worker` mỗi phút. Cron chỉ xử lý báo cáo Admin đã yêu cầu, chưa tự tạo báo cáo theo giờ. `enabled=false` và trial vẫn bật, nên dispatcher không gọi HTTP và chưa gửi tin thật.

Nút “Báo Cáo Zalo Ngay” giữ nguyên thiết kế, dùng ca đang chọn, ngày server và trạng thái chốt ca. Sau khi xác nhận, nút theo dõi cùng job tối đa hai phút; chỉ `sent` báo thành công. Pending/sending báo đang chờ; unknown yêu cầu đối chiếu, không tự gửi lại. Trong trial, thao tác bị chặn với thông báo rõ ràng.

Nguồn mới: [prepare-zalo-dispatch.sql](prepare-zalo-dispatch.sql), [prepare-zalo-cron.sql](prepare-zalo-cron.sql). Hai file không bật gửi và không thay người nhận. Kiểm tra Cron succeeded chỉ chứng minh dispatcher chạy; cần `sent` trong queue mới là xác nhận gửi.

Các mục bên dưới ghi lại bước xây dựng queue trước đó. Phần còn lại để vận hành thật: kết thúc trial, kiểm thử ca thật, bật cấu hình gửi theo quyết định chủ dự án; nếu muốn báo cáo tự tạo theo giờ cần bổ sung lịch tạo báo cáo riêng.

SQL 185 và Edge `zalo-report-worker` đã triển khai trên Supabase ngày 02/11/2026. Chưa cấu hình Bot/người nhận, chưa bật Cron gửi và chưa nối nút gửi cũ. Không có tin nhắn thật nào được gửi trong bước này; UI, trial QR, lịch và điểm danh giữ nguyên.

Nguồn: [prepare-zalo-delivery.sql](prepare-zalo-delivery.sql), [zalo-report-worker.ts](zalo-report-worker.ts). Kiểm tra bằng [check-zalo-delivery.sql](check-zalo-delivery.sql). Không chạy lại các bước đã hoàn tất.

## Luồng đã có

1. Admin yêu cầu báo cáo bằng `admin_enqueue_zalo_report(date,shift,type)`. Database kiểm tra Admin hoạt động, chế độ thử đã tắt, cấu hình gửi, phiên ca và báo cáo từ SQL 180.
2. Nội dung và người nhận được lưu cố định ở hàng đợi private. Mỗi ca chỉ có một báo cáo `early` và một `closing`; bấm lặp trả cùng job, không tạo thêm tin. Đây chưa phải tính năng gửi lại báo cáo đã sửa.
3. Worker xác thực bằng secret riêng trong Vault, nhận một job bằng khóa hàng. Chỉ service_role gọi được RPC nhận/hoàn tất; trình duyệt không đọc token hoặc hàng đợi.
4. Zalo trả `ok=true` và `message_id` hợp lệ thì đánh dấu `sent`. Lỗi được Zalo xác nhận thì `failed`; timeout, mất kết nối hoặc phản hồi không rõ thì `unknown`.
5. Job `sending` mất worker quá hai phút chuyển `unknown`, không quay lại hàng đợi. ACK muộn đúng lease vẫn cập nhật được kết quả. Không cam kết gửi đúng một lần khi nhà cung cấp không có khóa idempotency; ưu tiên tránh tự gửi trùng.

Job chưa gửi quá 10 phút, đổi người nhận hoặc Admin yêu cầu không còn quyền sẽ bị hủy. Báo cáo đầu ca cũng bị hủy nếu ca đã kết thúc. Tắt cấu hình chặn nhận việc mới; một HTTP đang gửi có thể đã được Zalo tiếp nhận nên vẫn cần đối chiếu kết quả.

Theo [tài liệu sendMessage chính thức](https://bot.zapps.me/docs/apis/sendMessage/), tin nhắn giới hạn 2.000 ký tự. Hiện báo cáo dài hơn giới hạn bị chặn, không tự cắt tên hoặc gửi nhiều tin một cách thiếu kiểm soát. Nội dung gửi dạng văn bản thuần, không kèm lý do xin nghỉ/email/device.

## Trước khi bật thật

- Hoàn tất kiểm thử lịch → ca thật và kết thúc trial QR.
- Xác nhận Bot và nhóm/người nhận; lưu Bot token mới tại Vault `lhtech_zalo_bot_token`, không dùng lại token từng xuất hiện trong frontend. Xác nhận người nhận ở cấu hình private trước khi bật. Không gửi token vào chat/GitHub.
- Chuẩn bị worker secret `lhtech_zalo_worker_secret` và dispatcher/Cron. Bước này chưa tạo các secret hoặc bật job.
- Nối nút Zalo hiện có với enqueue + theo dõi job: `pending/sending` không được báo “đã gửi”. Chỉ `sent` mới xác nhận gửi thành công. `unknown` cần đối chiếu Zalo trước khi xử lý thủ công.
- Gửi kiểm chứng chỉ khi chủ dự án đã xác nhận người nhận/nội dung. Không tự gửi thử cho sinh viên.

Kiểm thử: 196/196 đạt, gồm queue/lease/ACK muộn/quyền/HTTP lỗi và chuẩn UI tối. Live DB: enabled=false, queue rỗng, trial vẫn bật, automation thật tắt, không có Cron Zalo.

Hai bảng private có RLS, không cấp quyền bảng cho anon/authenticated nên không có policy đọc trực tiếp; [thông báo RLS không policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) là chủ đích ở các bảng này.
