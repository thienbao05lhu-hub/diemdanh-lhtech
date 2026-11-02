# Báo cáo Zalo tự động

SQL 187 đã triển khai ngày 02/11/2026. Cron `lhtech-zalo-delivery-worker` chạy mỗi phút bằng `private.tick_zalo_reports()`. **Tạo báo cáo và gửi thật vẫn tắt; thử QR vẫn bật.** Chưa gửi tin thật, chưa thay giao diện.

## Khi bật vận hành thật

- Báo cáo đầu ca đến hạn lúc 08:31, 13:31, 18:31 theo giờ Việt Nam.
- Báo cáo chốt ca chỉ tạo sau khi phiên thật đã hoàn tất chốt (`finalized_at`).
- Mỗi báo cáo có cửa sổ tạo 10 phút, chỉ ngày hiện tại và từ thời điểm bật. Không gửi bù báo cáo quá hạn.
- Dùng cùng dữ liệu với bảng điểm danh thật; danh sách dự kiến của phiên giữ nguyên ảnh chụp lúc mở ca. Lịch LHU cập nhật sau đó không viết lại phiên cũ.
- Nút gửi tay và Cron dùng chung khóa duy nhất theo phiên/loại báo cáo. Không tự gửi lại `failed` hoặc `unknown`.
- Tài khoản chịu trách nhiệm phải còn hoạt động và quyền Admin. Báo cáo dài hơn 2.000 ký tự bị chặn để đối chiếu.

## Tệp vận hành

1. [prepare-zalo-automation.sql](prepare-zalo-automation.sql) và [prepare-zalo-automation-cron.sql](prepare-zalo-automation-cron.sql) đã chạy; không cần chạy lại.
2. [check-zalo-automation.sql](check-zalo-automation.sql) chỉ đọc cấu hình/quyền/trạng thái Cron.
3. [enable-zalo-reports.sql](enable-zalo-reports.sql) **chưa chạy**. Chỉ dùng khi chủ dự án quyết định gửi thật, đã kết thúc thử QR và xác minh/bật vòng đời ca thật. Tệp kiểm tra Bot, nơi nhận, một Super Admin đang hoạt động và hàng đợi trước khi bật.
4. [disable-zalo-reports.sql](disable-zalo-reports.sql) dừng tạo/nhận việc mới, không xóa lịch sử. HTTP đã bắt đầu có thể đã được Zalo tiếp nhận; cần đối chiếu `sending`/`unknown`.

Token và khóa worker chỉ nằm trong Vault; các tệp này không chứa secret. Cron `succeeded` chỉ chứng minh tác vụ chạy, chưa chứng minh tin đã gửi; cần trạng thái `sent` được worker xác nhận.

## Kiểm chứng triển khai

207 kiểm thử đạt, gồm thời điểm Việt Nam, quá hạn, chống trùng giữa nút và Cron, chặn trial/containment, chặn tài khoản mất quyền, chốt ca và bật/tắt cấu hình. So sánh kết quả ba ca trên Supabase trước/sau thay đổi cho cùng mã băm. Cron chạy thành công; hai công tắc gửi/tạo báo cáo vẫn false, hàng đợi rỗng. Chưa kiểm thử gửi Zalo thật.
