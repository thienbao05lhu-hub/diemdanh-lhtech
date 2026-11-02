# Thử QR ngoài giờ trên giao diện cũ

Theo yêu cầu 02/11/2026, cho phép kiểm tra QR khi chưa có lịch/lớp và ngoài các giờ nhận điểm danh. Không thay thiết kế tối; dùng QR, camera, thẻ kết quả và nút Chốt ca hiện có. Đây là chế độ thử QR, không mở quyền anonymous, bỏ xác minh thiết bị hoặc biến dữ liệu thử thành chuyên cần thật.

## Bật và thử

1. Chủ project chạy toàn bộ `artifacts/enable-qr-test-mode.sql` (nguồn `supabase/schemas/150_qr_test_mode.sql`) sau SQL 140 đã có. File vừa cài các RPC thử vừa kích hoạt 24 giờ theo đồng hồ server. Không cần sửa giờ máy tính hoặc chạy lại SQL cũ.
2. Ctrl + F5 Admin và app trên các thiết bị thử. Admin hiện chữ **THỬ NGHIỆM** cạnh token trong khung OLED cũ. Sinh viên đăng nhập, xác nhận thiết bị như trước, bấm Tiếp Tục Quét Lại và quét mã Admin đang hiển thị. Thẻ kết quả ghi **THỬ: Quét QR thành công**.
3. Chưa có lớp hoặc lịch vẫn thử được. Ba tab ca giữ nguyên; ca thử chọn theo giờ VN: trước 12:00 Sáng, 12:00–18:00 Chiều, từ 18:00 Tối. Ngoài khung 07–11/13–17/18–22 vẫn có QR thử. Mã vẫn hết hạn sau 30 giây; khóa tài khoản, sai thiết bị và quyền Admin vẫn có hiệu lực.
4. Xem bảng ca và thống kê: dữ liệu lấy từ bảng thử private. Không có Vắng không phép tự tạo khi đóng thử. Chốt ca chỉ đóng phiên thử hiện tại, không mở lại phiên đó; có thể tiếp tục ca khác hoặc tắt rồi bật lại để bắt đầu context mới.
5. Kiểm tra `supabase/diagnostics/check-qr-test-mode.sql`: test_active=true, automation_enabled=false, trial_tables_locked=true. Không xem việc Cron hiện succeeded là bằng chứng đang đánh vắng thật, vì automation đã được chủ động dừng.

## Dữ liệu, hết hạn và kết thúc thử

Các lượt thử, phiên và challenge nằm trong bốn bảng private riêng, không ghi vào public.attendance hoặc đổi public.weekly_schedules. Audit ghi action attendance.test.* và tín hiệu Realtime chỉ truyền topic/UUID. Các tài khoản vẫn là tài khoản Auth thật; việc xác minh/reset thiết bị vẫn cập nhật ràng buộc thiết bị thật theo thiết kế đã chốt. Không tự tạo tài khoản/mật khẩu/lớp mẫu.

Để tránh nhầm dữ liệu, router chặn gửi/duyệt nghỉ và chỉnh trạng thái attendance thật trong chế độ thử QR. Nút cũ có thể vẫn hiển thị nhưng server route trả thông báo chưa thực hiện; không có success giả. Lưu lịch tuần vẫn dùng dữ liệu và RPC thật. Lịch sử toàn bộ attendance cũ và các công cụ chưa chuyển đổi không phải phạm vi dữ liệu thử này. CSV từ bảng ca thử phải được coi là dữ liệu thử, không dùng làm báo cáo chuyên cần chính thức.

Sau 24 giờ, chế độ thử tự hết hiệu lực. Chạy lại cùng file để gia hạn; nếu context cũ vẫn đang hoạt động thì giữ lượt thử cũ và gia hạn từ lúc chạy. Đã hết hạn hoặc đã tắt thì tạo context mới; không xóa lịch sử thử cũ. Dừng sớm bằng `artifacts/disable-qr-test-mode.sql`.

Automation thật được tắt ở config khi bật thử, không tự khôi phục sau khi hết hạn hoặc tắt thử. Khi sẵn sàng nghiệm thu chính thức: tắt thử, kiểm tra lịch/lớp, rồi chạy lại `artifacts/enable-attendance-cron.sql` để bật automation thật. File này giữ ngày bắt đầu gốc; phiên thật đã mở còn tồn có thể được chốt khi bật lại, cần đối chiếu trước khi dùng chính thức. Không thay đổi lịch sử đã đóng hoặc xóa dữ liệu để “làm sạch”. Containment 90 mới cũng tắt chế độ thử.

Router hỏi trạng thái server trước các RPC điểm danh, không dùng localStorage/URL để quyết định quyền. Khi lỗi mạng/trạng thái không hợp lệ, không tự rơi sang ghi attendance thật. Các RPC thử tự kiểm tra active/Auth/role, context và thời hạn tại thời điểm thực thi, nên hết hạn giữa lúc đọc capability và gửi QR sẽ bị từ chối.

## Lớp và LHU còn thiếu

Hai phần này nằm trong G1/G5 của kế hoạch chuyển đổi. Hiện adapter cloud trả department rỗng ở danh sách/báo cáo, nên “Chưa có lớp” có thể do dữ liệu chưa được nối, không chứng minh hồ sơ nguồn không có lớp. Cần bổ sung trường lớp, nối các API hiển thị và nhập/cập nhật từ nguồn có thật, không tự đoán lớp từ MSSV.

Nút đồng bộ LHU đang bị khóa có chủ ý vì cloud chưa có worker gọi API trường theo lô, checkpoint, preview, kiểm tra cấu trúc JSON và CAS lịch tuần. Kế tiếp cần hoàn thiện lớp/mapping, rồi nối nút cũ với worker LHU, giữ lịch khi API lỗi và bảo vệ lịch sửa tay. Không dùng thao tác trình duyệt tự động hoặc đưa token trường vào frontend. Bật thử QR không tự bật LHU/Zalo hoặc coi các phần đó đã hoàn tất.

## Bằng chứng

PGlite và VM kiểm chứng ngoài giờ, người không có lịch/lớp, quyền Admin/sinh viên/anon, proof thiết bị, TTL 30s, token thử không dùng ở RPC thật, cùng transaction audit, cô lập attendance, đóng thử, hết hạn/gia hạn/containment và router fail closed. Chưa thử camera/Realtime nhiều thiết bị hoặc chạy SQL mới trên Supabase thay người dùng.
