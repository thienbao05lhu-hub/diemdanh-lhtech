# Khóa quyền khẩn cấp cho bản Supabase đã chạy SQL cũ

Ngày 01/11/2026, chủ dự án xác nhận đã chạy các SQL PWA/leave/audit trên Supabase thật. Vì vậy các quyền mở trong installer phải được xử lý tại database, không chỉ sửa giao diện hoặc push GitHub.

## Bản chuẩn bị

- Nguồn: `supabase/schemas/90_security_containment.sql`.
- Bản để chạy: `artifacts/security-containment.sql`, sao chép nguyên nguồn, có kiểm tra checksum khi tạo.
- Kiểm tra sau chạy: `supabase/diagnostics/check-containment.sql`.

Đây là phương án giới hạn ghi khẩn cấp, không phải toàn bộ bản sửa ứng dụng. Script giữ dữ liệu, UID và mật khẩu. Auth, đọc theo RLS và các RPC hồ sơ/lịch tuần có kiểm tra quyền vẫn được cấp cho người đăng nhập phù hợp. Script không xác minh mật khẩu Auth của tài khoản thật.

Sau khi áp dụng, quét điểm danh, duyệt nghỉ, sửa/hủy điểm danh và các thao tác dựa trên quyền ẩn danh/raw writes sẽ bị chặn cho tới khi có bản thay thế an toàn. Workflow Zalo đang đọc bằng publishable key ẩn danh cũng sẽ không lấy được dữ liệu. Cần tính đây là cửa sổ bảo trì, không coi UI báo thành công cũ là đã ghi database.

## Cách áp dụng

1. Sao lưu dữ liệu và ghi nhận người đang sử dụng trước cửa sổ bảo trì. Không tải dump lên repo public.
2. Mở SQL Editor của đúng project `oalnswbnjhkkovxjxtlz`: https://supabase.com/dashboard/project/oalnswbnjhkkovxjxtlz/sql/new.
3. Chạy toàn bộ `artifacts/security-containment.sql` bằng quyền chủ project. Có kiểm tra bảng và chủ đang hoạt động trước sửa; mọi thay đổi quyền nằm trong một transaction. Lỗi/lock timeout thì transaction không áp dụng, cần kiểm tra nguyên nhân.
4. Chạy `supabase/diagnostics/check-containment.sql`. Các quyền anon/read-write, raw writes của authenticated và quyền gọi RPC bị dừng phải false.
5. Tự thử đăng nhập email/mật khẩu bằng Supabase Auth; kiểm tra Admin đọc được đúng dữ liệu. Không dùng fallback admin_verify_password hoặc sửa localStorage làm bằng chứng đã đăng nhập.
6. Không chạy lại `diemdanh-pwa-fix.sql`, `create-leave-requests-table.sql` hoặc `fix-audit-logs-and-leaves.sql` cũ vì sẽ mở lại quyền. Không quay về using(true) để chữa lỗi giao diện.

## Tiếp theo

Đối chiếu hồ sơ/vai trò/UID thật; thu hồi và thay Zalo token đã có trong frontend, thay GitHub token đã hiển thị. Hoàn thiện frontend xác thực thật, RPC điểm danh/đơn nghỉ có kiểm tra Auth UID/giờ/khóa và audit nguyên tử; chuyển Zalo/LHU ra server. Chỉ mở lại từng RPC sau kiểm thử quyền và nghiệp vụ.

Hiện công cụ chưa có connector/credential quản trị Supabase. File mới chỉ được soát nguồn và kiểm tra tĩnh cục bộ; chưa chạy PostgreSQL hoặc project thật, chưa tuyên bố đã vá production. Cần chủ project chạy và trả kết quả kiểm tra, hoặc cấp kết nối quản trị được ủy quyền qua kênh phù hợp, không gửi secret qua chat.
