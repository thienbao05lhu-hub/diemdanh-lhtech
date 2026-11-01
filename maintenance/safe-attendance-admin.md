# Điều chỉnh điểm danh bằng nút Admin cũ

Giữ nguyên giao diện tối đã chốt: không thêm nút, form, panel hoặc đổi CSS. Nối các nút **Đúng giờ**, **Xin phép / Vắng CP**, **Hủy phép**, **Hủy quét** vào RPC mới có kiểm tra quyền/phiên bản. Các nút reset dữ liệu hàng loạt, LHU và Zalo vẫn tạm khóa.

## Cập nhật database

1. Sao lưu trước khi thay đổi. Mở SQL Editor của project `oalnswbnjhkkovxjxtlz` bằng tài khoản chủ.
2. Đã áp dụng QR 100. Nếu chưa chạy `artifacts/restore-safe-leaves.sql`, chạy toàn bộ file đó trước. Chưa có xác nhận người dùng đã áp dụng 110 trong phiên này; không bỏ qua điều kiện này.
3. Chạy toàn bộ `artifacts/restore-safe-attendance-admin.sql`, bản sao đúng của `supabase/schemas/120_safe_attendance_admin.sql`. Không sửa UID hoặc mật khẩu. Thành công trả: **Đã bật chỉnh trạng thái và hủy quét an toàn. LHU, Zalo và reset hàng loạt vẫn tạm khóa.**
4. Chạy từng SELECT trong `supabase/diagnostics/check-safe-attendance-admin.sql`. Bảng public vẫn không ghi trực tiếp; private không đọc/ghi từ client; anonymous không có quyền. RPC legacy vẫn tắt. Hai trigger version phải đang hoạt động.
5. Tải lại Admin rồi tải lại bảng điểm danh trước khi thao tác. Trước khi SQL có hiệu lực, nút cũ vẫn báo chờ cập nhật, không có thành công giả. Không chạy lại các installer PWA mở quyền cũ.

120 tự chứa các hàm đọc bảng và duyệt nghỉ cần cập nhật để tương thích version, nên không cần chạy lại 100. Thứ tự nguồn thủ công là 10/20/30/40, rồi 90, 100, 110, 120; không áp dụng glob theo thứ tự chữ cái. Chạy lại 120 không sửa trạng thái hoặc xóa điểm danh đang có.

## Hành vi

- Chỉ Admin active hoặc super_admin mới được gọi; không tự sửa điểm danh của chính mình. Admin thường chỉ sửa sinh viên, super_admin có thể sửa người khác có vai trò Admin. Danh tính người thao tác lấy từ Auth UID/database.
- Chỉ điều chỉnh ngày hiện tại theo giờ Việt Nam, trước 11:00 / 17:00 / 22:00 tương ứng ca. Ca chốt sớm và bản ghi is_locked luôn bị chặn, kể cả giao diện cũ còn nút Xin phép ở hàng đã khóa. Không có đường mở khóa hoặc sửa hồi tố trong bước này.
- **Đúng giờ:** chỉ đổi Đi trễ thành Có mặt, giữ nguyên thời gian quét gốc.
- **Xin phép / Vắng CP:** tạo vắng có phép từ dòng chưa có bản ghi, hoặc đổi Vắng không phép/Đi trễ chưa khóa. Không đổi Có mặt thành vắng qua RPC này. Lưu snapshot trước đó để hủy đúng thay đổi; không tự tạo lịch xưởng rảnh.
- **Hủy phép:** chỉ hoàn tác vắng có phép được tạo bởi luồng thủ công này và còn đúng phiên bản. Nếu trước đó là Đi trễ/Vắng không phép, khôi phục thời gian/trạng thái/ghi chú cũ; nếu dòng được tạo riêng cho phép này thì chỉ xóa dòng đó. CP cũ không rõ nguồn gốc phải đối chiếu, không xóa tùy ý.
- **Hủy quét:** chỉ hủy đúng bản ghi Có mặt/Đi trễ đã xem. Lưu nhật ký trước khi transaction kết thúc. Không gọi reset hoặc xóa cả ngày.
- Nếu có đơn nghỉ approved cùng ca, thao tác thủ công trả hướng dẫn dùng **Hủy duyệt** ở danh sách đơn nghỉ trước. Điều này giữ đơn nghỉ và điểm danh nhất quán. Sau khi QR thay vắng được duyệt bằng có mặt, hủy duyệt giữ lần quét; sau đó Admin mới hủy quét nếu cần.
- Theo giao diện đã chốt, chưa thêm trường nhập lý do. Lý do mặc định ghi đúng tên thao tác Admin đã chọn; đây không phải lý do nghỉ do sinh viên khai. RPC vẫn bắt buộc lý do 1–500 ký tự cho các client tích hợp khác.

## Chống ghi đè và khôi phục

Mỗi lượt insert/update attendance có edit_revision mới, kể cả từ QR, đơn nghỉ hoặc chốt ca. Hai trường recordId/recordRevision được đọc cùng hàng trên bảng Admin và gửi lại khi bấm nút. Hộp xác nhận Hủy quét giữ snapshot lúc mở, không tự lấy phiên bản mới trong lúc chờ.

Một bảng private riêng giữ version của trạng thái trống sau delete. Vì vậy, dòng trống được xem từ trước một lượt tạo rồi hủy không được dùng để âm thầm ghi thay đổi mới. Khóa theo profile UUID, rồi ngày/ca, session và attendance; đọc lại giờ server sau khóa. Chỉnh điểm danh, provenance và audit cùng transaction; lỗi audit hoàn tác cả lượt sửa và version.

Sau lỗi hoặc timeout, adapter bỏ snapshot đã dùng. Tải lại bảng để đối chiếu trước khi thử lại; không tự retry thao tác xóa. Audit và snapshot thủ công loại bỏ device_fingerprint, không lưu token QR hoặc proof thiết bị. Các effect đơn nghỉ tạo trước khi có edit_revision vẫn hoàn tác được khi toàn bộ dữ liệu còn khớp và chưa có lượt sửa mới.

## Kiểm thử và giới hạn

Dùng tài khoản thử riêng; không sửa hồ sơ thật hoặc chốt ca đang vận hành chỉ để thử. Đã có fixture SQL/PGlite và JavaScript Auth/DOM cho quyền, revision, xóa rồi tạo lại, phiên bản cũ, ca khóa/ngoài giờ, rollback audit, QR/đơn nghỉ tương thích và phản hồi lỗi không báo thành công. Kiểm thử một kết nối không chứng minh cạnh tranh nhiều kết nối PostgreSQL thật. Chưa chạy SQL 120 trên Supabase thay người dùng hoặc thử camera thật.

Khi cần tạm dừng, dùng bản mới `artifacts/security-containment.sql`; nó thu hồi cả admin_adjust_attendance. Dữ liệu và hai trigger version được giữ nguyên. Muốn khôi phục sau containment phải theo thứ tự QR -> nghỉ -> điều chỉnh Admin; không mở lại RPC legacy.

Nguồn: [Supabase functions](https://supabase.com/docs/guides/database/functions), [PostgreSQL locking](https://www.postgresql.org/docs/current/explicit-locking.html).
