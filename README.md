## Cập nhật tự động Admin — SQL 120 đã được xác nhận, chuẩn bị SQL 130

Chủ project xác nhận chạy thành công SQL chỉnh/hủy điểm danh 120 ngày 01/11/2026; preflight của 120 yêu cầu 110. Bước mới thêm tín hiệu Realtime và tải lại dữ liệu theo Auth/RLS, giữ nguyên giao diện tối đã chốt. Chạy [enable-live-refresh.sql](maintenance/enable-live-refresh.sql), kiểm tra [check-live-refresh.sql](maintenance/check-live-refresh.sql), rồi nghiệm thu theo [live-refresh.md](maintenance/live-refresh.md). SQL 130 chưa được công cụ áp dụng lên Supabase. Trước khi bật Realtime, web vẫn tải lại định kỳ khi có quyền.

Các ghi chú cũ bên dưới mô tả trạng thái tại thời điểm từng bước; trạng thái mới nhất ở đoạn này. LHU, Zalo, reset hàng loạt, ESP32 và đánh vắng tự động vẫn chưa hoàn tất. Chưa nghiệm thu WebSocket/camera/phiên Auth thật bằng công cụ.

## Điều chỉnh điểm danh Admin — chờ áp dụng SQL 120

Giữ nguyên các nút của giao diện tối, nối Đúng giờ / Xin phép / Hủy phép / Hủy quét với kiểm tra phiên bản tại database. Chỉ sửa đúng bản ghi đã xem, không sửa ca khóa/đã hết giờ, không tự sửa điểm danh của chính mình. Đơn nghỉ approved được xử lý qua luồng đơn nghỉ; CP thủ công có snapshot để hoàn tác đúng thay đổi. Dòng trống sau xóa cũng có phiên bản, không mặc định trở lại zero.

Chủ project cần chạy SQL nghỉ 110 trước nếu chưa áp dụng, sau đó [restore-safe-attendance-admin.sql](maintenance/restore-safe-attendance-admin.sql). Xem [hướng dẫn](maintenance/safe-attendance-admin.md) và [kiểm tra quyền](maintenance/check-safe-attendance-admin.sql). Chưa có SQL mới thì chức năng trả lỗi chờ cập nhật, không báo đã ghi giả. Không thêm hoặc đổi bố cục/CSS/nút đã chốt. Chưa nghiệm thu runtime Supabase/camera thật.

## Logic dashboard đã nối lại, giữ nguyên giao diện tối

Nút lưu lịch từng người, lưu hàng loạt và khôi phục lịch sử trên dashboard cũ đã nối với RPC kiểm tra Auth/role/revision. Lưu không tự lấy phiên bản mới để ghi đè người khác. Gửi hàng loạt theo thứ tự, giữ bản nháp và phiên bản đã đọc khi một người lỗi; khóa tạm editor trong lúc lưu. Phản hồi đọc về trễ không ghi đè bản nháp vừa chỉnh.

Hai nút CSV giữ nguyên giao diện, xuất đủ dữ liệu ba ca và tiếng Việt; escape phẩy/nháy/xuống dòng và chặn ô bị hiểu thành công thức. Giờ duyệt nghỉ không được ghi là giờ quét. Tên/ghi chú/từ khóa ở bảng điểm danh được hiển thị như văn bản.

Thay đổi này không yêu cầu SQL mới: dùng các RPC lịch tuần 30 đã được containment giữ lại. Nếu thiếu RPC/quyền, thao tác trả lỗi và không báo đã lưu. Đã kiểm thử cục bộ với Auth/DOM mô phỏng và SQL fixture; chưa thay thế nghiệm thu cloud/thiết bị thật. SQL xin nghỉ 110 vẫn chờ xác nhận áp dụng riêng, LHU/Zalo/sửa điểm danh thủ công chưa được bật.

## Giữ nguyên thiết kế đã chốt

Đã khôi phục app/checkin về giao diện PWA gốc: kích hoạt thiết bị, khung camera, thẻ kết quả, nút báo nghỉ và modal xin nghỉ. Người dùng đã xác nhận rõ kiểu giao diện tối sau yêu cầu đọc lại toàn bộ dự án. Chuẩn cấu trúc/CSS là bản tối `2848827`: Kích Hoạt Thiết Bị, khung camera và hộp thoại báo nghỉ. Giữ nguyên thiết kế này; chỉ hoàn thiện logic và sửa lỗi. Logic mới dùng đúng các thành phần đó; không thêm panel hoặc thay hệ thống màu/font. Mã sinh viên trên màn hình kích hoạt lấy từ tài khoản Auth đang đăng nhập, không cấp quyền bằng MSSV tự nhập.

Bấm nút xác nhận thiết bị cũ để xác minh; dùng nút **Tiếp Tục Quét Lại** cũ để mở camera hoặc xác nhận token từ liên kết QR. Các thông báo dùng thẻ kết quả/toast cũ. Xin nghỉ dùng modal cũ, chỉ mở khi SQL nghỉ đã được áp dụng. Thiết bị cũ đã đăng ký sẽ được xác minh bằng khóa lưu tại trình duyệt; khóa bí mật không hiển thị ra màn hình.

Không thay SQL/RLS để khôi phục thiết kế. QR đã được chủ project xác nhận áp dụng SQL và kiểm tra quyền; SQL xin nghỉ vẫn chờ xác nhận riêng. Các ghi chú phía dưới thuộc giai đoạn trước.

## Cập nhật xin nghỉ/xét duyệt — chờ áp dụng SQL mới

Chủ project đã xác nhận chạy SQL QR và gửi kết quả ACL/RLS đúng. Bản mới bổ sung đơn nghỉ theo Auth UID và xét duyệt bằng số phiên bản; chưa chạy SQL nghỉ trên Supabase thay người dùng. Đọc [hướng dẫn](maintenance/safe-leaves.md), chạy toàn bộ [restore-safe-leaves.sql](maintenance/restore-safe-leaves.sql) rồi [check-safe-leaves.sql](maintenance/check-safe-leaves.sql). Không cần chạy lại SQL QR hay các installer PWA cũ.

Trước khi SQL mới có hiệu lực, form/nút duyệt vẫn khóa; đơn cũ vẫn đọc theo RLS. Sau khi bật, gửi đơn chỉ tạo chờ duyệt, xét duyệt không ghi đè có mặt/ca khóa và hủy duyệt có đối chiếu nguồn gốc. Sửa điểm danh thủ công, LHU, Zalo, ESP32 và đánh vắng tự động chưa hoàn tất. Phần QR/nghỉ vẫn cần nghiệm thu thật; các ghi chú phía dưới thuộc giai đoạn trước.

## Cập nhật QR có kiểm soát — 01/11/2026

Đã có giao diện Auth/thiết bị/QR mới, Admin chốt phiên và mở khóa thiết bị. Chỉ bật sau khi chủ project chạy toàn bộ [restore-safe-qr.sql](maintenance/restore-safe-qr.sql) trên Supabase đã áp dụng containment. Nếu chưa chạy hoặc RPC bị khóa, giao diện giữ chế độ tạm dừng. Đọc [hướng dẫn nghiệm thu](maintenance/safe-qr.md) và [SQL kiểm tra quyền](maintenance/check-safe-qr.sql).

QR chưa nghiệm thu trên Supabase/điện thoại thật; kiểm thử cục bộ dùng Auth/DOM mô phỏng. Duyệt nghỉ, sửa điểm danh, đồng bộ LHU, Zalo và ESP32 chưa được mở. Các ghi chú bên dưới mô tả các giai đoạn trước.

# Điểm danh LHTech — frontend Supabase

## Cập nhật 01/11/2026: đang giới hạn ghi

Chủ project đã xác nhận chạy bản khóa quyền và gửi ảnh 7 bảng với policy `contained_read` chỉ SELECT cho authenticated. Dashboard dùng `js/supabase-read-api.js`: mỗi yêu cầu kiểm tra Supabase Auth và hồ sơ đang hoạt động; không dùng mật khẩu dự phòng, vai trò localStorage, hồ sơ tĩnh hoặc nhật ký mẫu. Login dùng email/MSSV và mật khẩu Auth thật. Token Zalo đã gỡ khỏi nguồn hiện tại; token cũ trong lịch sử vẫn cần chủ project thu hồi.

Điểm danh, duyệt nghỉ, chỉnh sửa trên dashboard, đồng bộ LHU và Zalo đang tạm dừng. API ghi trả lỗi bảo trì, không trả thành công giả; camera và lịch gửi Zalo tự động đã tạm ngừng. Các bảng đọc dữ liệu thật theo RLS. Trang lịch riêng `schedule.html` tiếp tục dùng các RPC lịch tuần có kiểm tra quyền/revision mà SQL đã giữ lại.

Trước khi mở lại ghi, cần thay RPC tương ứng, kiểm thử Auth/role/UID/giờ/khóa/đồng thời và nghiệm thu thật. Các hướng dẫn schema phía dưới không có nghĩa mọi nút dashboard đã được mở.

Bản chuyển đổi đang triển khai: đăng nhập bằng Supabase Auth, thiết lập/khôi phục mật khẩu qua email, quản lý hồ sơ/vai trò, lịch xưởng theo tuần có lịch sử/khôi phục và nhật ký. Điểm danh QR, duyệt nghỉ, đồng bộ LHU, Zalo, ESP32 và chuyển dữ liệu cũ chưa hoàn tất. Chưa dùng bản này để thay hệ thống đang vận hành.

Website là HTML/CSS/JavaScript tĩnh, không cần npm hay bước build. Bản SDK Supabase chính thức 2.118.0 được phục vụ trong `vendor/`, kèm giấy phép MIT.

Đưa **nội dung của thư mục này** lên gốc repository `thienbao05lhu-hub/diemdanh-lhtech`. Trong GitHub, chọn Settings > Pages > Deploy from a branch > main > /(root). Địa chỉ dự kiến khi Pages được bật: `https://thienbao05lhu-hub.github.io/diemdanh-lhtech/`.

Cấu hình công khai trong `js/config.js` chỉ chứa project URL và publishable key. Tài khoản đăng nhập phải tồn tại trong Supabase Auth và có hồ sơ tương ứng trong bảng `profiles`. SDK quản lý phiên trong localStorage với khóa `lhtech-supabase-auth`; mật khẩu không được lưu trong storage. Quyền dữ liệu do PostgreSQL/RLS kiểm tra.

Để dùng liên kết xác nhận/thiết lập mật khẩu, đặt Site URL của Supabase Auth thành `https://thienbao05lhu-hub.github.io/diemdanh-lhtech/` và thêm Redirect URL chính xác `https://thienbao05lhu-hub.github.io/diemdanh-lhtech/reset-password.html`. Trang `reset-password.html` gửi yêu cầu email qua Auth và chỉ mở form mật khẩu sau khi Auth xác minh phiên. Liên kết quay về trang chủ được chuyển tới trang thiết lập trước khi xử lý đăng nhập thông thường. Việc thiết lập mật khẩu giữ nguyên Auth UID và hồ sơ đã có.

Chỉ xuất bản các file trong thư mục này. Không đưa `.env`, dữ liệu MongoDB, mã khóa ESP32/Zalo hoặc mật khẩu lên repository public.

## Hồ sơ và lịch tuần

Trước khi dùng các nút quản lý hồ sơ/lịch, chủ project chạy schema `20_members.sql` và `30_weekly_schedules.sql` sau `10_identity.sql`, hoặc chạy installer `diemdanh-lhtech-members-schedules.sql` đã tạo từ hai nguồn schema. Schema không thay Auth UID hay mật khẩu hiện có.

Admin cấp hồ sơ bằng email của một tài khoản Auth đã được tạo trước. Hồ sơ mới luôn là sinh viên. Chỉ Quản trị cao nhất thay đổi vai trò Admin; không thể tự hạ quyền hoặc khóa tài khoản đang sử dụng. MSSV của hồ sơ đã tạo được giữ cố định.

Trang `schedule.html` lưu ca lên xưởng cho từng thành viên và từng tuần bắt đầu thứ hai, có lý do thay đổi, kiểm tra phiên bản trước khi ghi, lịch sử tối đa 50 phiên bản và khôi phục thành phiên bản mới. Sinh viên xem lịch của mình tại `app.html` và không được ghi lịch. Chưa có lịch và lịch đã lưu với mọi ca bỏ chọn là hai trạng thái khác nhau.
