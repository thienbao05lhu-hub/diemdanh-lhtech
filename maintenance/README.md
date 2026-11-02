## Bàn giao Super Admin riêng, rồi cấp mật khẩu đủ 23 sinh viên

Lỗi số lượng hiện có 22 là đúng; chưa thay mật khẩu. Xem `super-admin-transfer.md` để dùng ba file owner-only trong artifacts riêng và tạo Auth user mới qua Dashboard. Chỉ sau đăng nhập tài khoản mới được xác nhận mới hoàn tất chuyển quyền. Sau đó chạy lại bản mới file khởi tạo 23 sinh viên; tài khoản 123000896 lúc này có role student nên được tính. Không chạy bootstrap chủ đầu tiên hoặc installer cũ.

## Cấp mật khẩu ban đầu — 23 sinh viên, giữ nguyên Admin

Xem `student-passwords.md`. Operation có mật khẩu nằm riêng trong workspace, không đăng lên Pages. Chủ project chạy bản riêng trong SQL Editor; script dừng nếu số hồ sơ sinh viên active không đúng 23. Sau đăng nhập, dùng nút Đổi cũ → chọn 1 để tự đổi mật khẩu.

## Bước hiện tại — thử QR ngoài giờ

Chạy `enable-qr-test-mode.sql` để mở thử 24h và tạm dừng đánh vắng thật. Ctrl + F5 Admin/app, quét thử trên giao diện tối cũ; không cần lớp hoặc lịch để thử. Đọc `qr-test-mode.md`, kiểm tra `check-qr-test-mode.sql`. Tắt bằng `disable-qr-test-mode.sql`; automation thật không tự bật lại. Lớp/LHU chưa hoàn tất, đang nằm trong các bước chuyển đổi kế tiếp.

## Bước hiện tại — mở/chốt ca, 02/11/2026

SQL 130 đã có ảnh kiểm tra đúng đầy đủ; Realtime qua thiết bị thật chưa được xác nhận. Chạy `restore-safe-session-finalization.sql` (140), sau đó bật pg_cron tại Integrations > Cron và chạy `enable-attendance-cron.sql` (141). Kiểm tra `check-session-finalization.sql` và `check-attendance-cron.sql`. Đọc `session-finalization.md`; dừng riêng job bằng `disable-attendance-cron.sql` khi cần. Hai SQL mới chưa được công cụ áp dụng lên Supabase. Giữ nguyên giao diện tối; không chạy lại các bước đã xong.

## Bước hiện tại: cập nhật tự động Admin

Chủ project đã xác nhận SQL 120 chạy thành công; điều kiện 110 được kiểm tra trong 120. Không cần chạy lại các bước đó. Chạy toàn bộ `enable-live-refresh.sql`, rồi từng SELECT của `check-live-refresh.sql`. Đọc `live-refresh.md` để thử quét, kết nối lại và giữ bản nháp trên giao diện tối hiện có. Bước 130 này đang chuẩn bị, chưa được áp dụng vào Supabase từ công cụ. Các ghi chú trạng thái bên dưới thuộc những bước trước.

## Sau bước nghỉ: chỉnh điểm danh Admin an toàn

Nếu chưa chạy SQL nghỉ, chạy `restore-safe-leaves.sql` trước. Sau đó chạy `restore-safe-attendance-admin.sql`, kiểm tra `check-safe-attendance-admin.sql` và đọc `safe-attendance-admin.md`. Không chạy lại installer mở quyền cũ. Giao diện tối giữ nguyên; nút cũ chỉ sửa khi có snapshot/phiên bản mới hợp lệ. Chưa có xác nhận SQL 110/120 đã chạy thật.

## Bước sau QR: xin nghỉ và xét duyệt

Đã chạy QR thì chỉ cần chạy `restore-safe-leaves.sql` cho bước mới, sau đó kiểm tra `check-safe-leaves.sql`. Xem `safe-leaves.md`. Không chạy lại các installer mở quyền cũ. Bản containment hiện tại khóa cả các RPC nghỉ mới nếu cần dừng ghi.

## Bước tiếp theo: QR an toàn

Chạy `restore-safe-qr.sql` sau containment, rồi `check-safe-qr.sql`. Xem `safe-qr.md` để thử với tài khoản riêng. Chưa chạy SQL mới thì giao diện không bật QR. Không chạy lại installer PWA mở quyền cũ. Bản `security-containment.sql` mới cũng khóa đăng ký thiết bị/chốt ca/QR/reset khi cần dừng ghi.

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

Chủ project đã chạy bản khóa quyền trên Supabase thật và gửi ảnh thông báo hoàn tất cùng 7 policy contained_read/SELECT/authenticated ngày 01/11/2026. Công cụ chưa có connector quản trị và chưa kiểm thử phiên Auth/UI thật sau thay đổi. Giao diện đang được đồng bộ với trạng thái giới hạn ghi; chỉ mở lại nghiệp vụ sau bản RPC an toàn và kiểm thử phù hợp.


## 2026-11-02 — Lớp sinh viên và đồng bộ LHU có xem trước

Đã nhận xác nhận bàn giao Super Admin riêng và thử QR thành công từ chủ dự án. Bước kế tiếp: 160 bổ sung lớp, loại Admin khỏi bộ đếm sinh viên; 170 lấy lịch bằng Edge worker, xem trước rồi áp dụng có CAS. Giữ nguyên giao diện đã chốt. SQL và Edge mới chưa chạy trên Supabase thật. Làm theo `cloud/web/maintenance/lhu-sync.md` (trên Pages: `maintenance/lhu-sync.md`). Không chạy lại installer cũ; chưa bật lại automation điểm danh thật hoặc Zalo.


### Triển khai LHU thật — 02/11/2026

Đã áp dụng backend LHU, extension pg_net, xác thực worker qua Vault và Cron mỗi phút trên project oalnswbnjhkkovxjxtlz. Không còn bước nhập LHU_WORKER_SECRET thủ công. Edge tự kiểm tra JWT cho yêu cầu Admin; chỉ service_role gọi RPC xác thực/nhận việc. Worker đã phản hồi HTTP 200 và heartbeat thật. Giữ nguyên chế độ QR thử, automation đánh vắng thật vẫn tắt. Chỉ tạo bản xem trước lịch; việc áp dụng dùng nút xác nhận hiện có.
## 02/11/2026 — Lịch LHU và bước chuẩn bị báo cáo Zalo

Đã xác minh 23 lịch nguồn LHU được áp dụng trên Supabase. Bảng hôm nay vẫn dùng dữ liệu thử QR; không thay đổi chế độ thử hoặc snapshot ca thật. Xem [giải thích và các bước tiếp theo](zalo-report-preview.md), đối chiếu bằng [check-lhu-attendance-link.sql](check-lhu-attendance-link.sql).

Đã triển khai SQL 180 tạo bản xem trước báo cáo cho Admin; không gửi tin, chưa có Cron Zalo. Báo cáo thật bị chặn khi còn bật thử QR và báo cáo chốt yêu cầu ca được chốt ở database. Giao diện giữ nguyên. Các ghi chú về những bước trước là lịch sử triển khai, không cần chạy lại các bước đã hoàn tất.
