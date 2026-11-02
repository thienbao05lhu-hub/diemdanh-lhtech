/* Dashboard cũ: chỉ đọc, cộng các RPC QR đã kiểm tra và có capability server. */
(function (root) {
  'use strict';
  const config = root.ATTENDANCE_CONFIG;
  if (!config || !root.supabase?.createClient) return;
  const client = root.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: { storage: root.localStorage, storageKey: 'lhtech-supabase-auth', persistSession: true,
      autoRefreshToken: true, detectSessionInUrl: false },
  });
  root.supabaseClient = client;
  root.AttendanceTrialRouter?.install(client);
  const networkFetch = root.fetch.bind(root);
  const roles = ['admin', 'super_admin'];
  const maintenance = 'Hệ thống đang giới hạn ghi để cập nhật bảo mật. Chức năng này tạm dừng; chưa có dữ liệu được ghi.';
  const baseFields = 'id,student_id,display_name,role,active,updated_at';
  let fields = baseFields + ',department';
  let profiles = [];
  const attendanceSnapshots = new Map(), attendanceWrites = new Set();
  const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  // Xóa mật khẩu dự phòng từng được lưu; không đọc hoặc gửi các giá trị này.
  for (const key of Object.keys(root.localStorage)) {
    if (key === 'adminPass' || key.startsWith('admin_custom_pw_')) root.localStorage.removeItem(key);
  }
  function response(body, status = 200) {
    return new Response(JSON.stringify(body), { status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  }
  function fail(status, message) { throw Object.assign(new Error(message), { status }); }
  function checked(result) {
    if (result.error) fail(result.status === 401 ? 401 : result.status === 403 ? 403 : 503,
      'Không đọc được dữ liệu từ Supabase. Hãy kiểm tra phiên đăng nhập và thử lại.');
    return result.data;
  }
  async function qrCapabilities() {
    const result = await client.rpc('get_attendance_capabilities');
    if (result.error && ['PGRST202','42501'].includes(result.error.code)) {
      root.dispatchEvent(new CustomEvent('attendance-capability', { detail: { qrEnabled: false } }));
      return null;
    }
    const data = checked(result);
    if (!data || data.version !== 1 || typeof data.qrEnabled !== 'boolean') fail(503, 'Chưa xác minh được trạng thái điểm danh.');
    root.dispatchEvent(new CustomEvent('attendance-capability', { detail: { qrEnabled: data.qrEnabled } }));
    return data;
  }
  async function qrRpc(name, args) {
    const result = await client.rpc(name, args);
    if (result.error) {
      const errors = {
        APP_OUTSIDE_WINDOW: 'Hiện ngoài giờ nhận điểm danh.',
        APP_QR_PAUSED: 'Mã QR đang được quản trị viên tạm dừng phát.',
        APP_TEST_MODE_EXPIRED: 'Phiên thử đã hết hạn hoặc bị tắt. Tải lại trang để kiểm tra.',
        APP_TEST_QR_ONLY: 'Chế độ hiện tại chỉ thử QR; gửi/duyệt nghỉ và sửa điểm danh thật đang tạm dừng.',
        APP_SESSION_CLOSED: 'Ca này đã chốt, không thể mở lại mã QR.',
        APP_SESSION_NOT_FOUND: 'Ca này chưa mở phiên QR.',
        APP_FORBIDDEN: 'Tài khoản không có quyền thực hiện thao tác này.',
        APP_INVALID_INPUT: 'Thông tin gửi lên chưa hợp lệ.',
        APP_LEAVE_STALE: 'Đơn đã được xử lý ở nơi khác. Tải lại danh sách trước khi quyết định.',
        APP_LEAVE_REASON_REQUIRED: 'Cần nhập lý do khi từ chối hoặc hủy duyệt.',
        APP_LEAVE_SELF_REVIEW: 'Bạn không được tự xét duyệt đơn của mình.',
        APP_LEAVE_ATTENDANCE_CONFLICT: 'Điểm danh đã có thay đổi hoặc đã có mặt. Không thay đổi đơn và điểm danh.',
        APP_LEAVE_RECOVERY_REQUIRED: 'Đơn cũ cần đối chiếu dữ liệu trước khi xử lý; chưa có thay đổi được lưu.',
        APP_LEAVE_OWNERSHIP: 'Đơn cũ chưa khớp hồ sơ. Cần đối chiếu trước khi xử lý.',
        APP_LEAVE_TRANSITION: 'Quyết định không phù hợp với trạng thái hiện tại của đơn.',
        APP_LEAVE_NOT_FOUND: 'Không tìm thấy đơn nghỉ.',
        APP_SHIFT_LOCKED: 'Ca đã chốt hoặc đã hết giờ. Không được thay đổi đơn nghỉ.',
        APP_SCHEDULE_STALE: 'Lịch đã được sửa ở nơi khác. Bản nháp được giữ lại; hãy đối chiếu lịch mới trước khi lưu lại.',
        APP_INVALID_SCHEDULE: 'Lịch chưa hợp lệ. Chỉ chọn các ca Sáng, Chiều, Tối cho đúng bảy ngày.',
        APP_REVISION_NOT_FOUND: 'Phiên bản lịch này không còn trong lịch sử được lưu.',
        APP_PROFILE_NOT_FOUND: 'Hồ sơ không tồn tại hoặc đã bị khóa.',
        APP_ATTENDANCE_STALE: 'Điểm danh vừa thay đổi. Tải lại bảng trước khi thao tác lại.',
        APP_ATTENDANCE_LEAVE_MANAGED: 'Ca này có đơn nghỉ đã duyệt. Hãy dùng Hủy duyệt trong danh sách đơn nghỉ trước.',
        APP_ATTENDANCE_RECOVERY: 'Bản ghi nghỉ cũ cần đối chiếu nguồn gốc; chưa có dữ liệu bị xóa.',
        APP_ATTENDANCE_TRANSITION: 'Thao tác không phù hợp trạng thái hiện tại. Tải lại bảng để kiểm tra.',
        APP_ATTENDANCE_DATE: 'Dữ liệu không còn thuộc ngày hiện tại. Tải lại bảng điểm danh.',
        APP_SELF_ATTENDANCE_EDIT: 'Không được tự điều chỉnh điểm danh của tài khoản đang đăng nhập.',
      };
      for (const [code,text] of Object.entries(errors)) if (String(result.error.message).includes(code)) fail(409,text);
    }
    return checked(result);
  }
  async function leaveCapabilities() {
    const result = await client.rpc('get_leave_capabilities');
    if (result.error && ['PGRST202','42501'].includes(result.error.code)) {
      root.dispatchEvent(new CustomEvent('leave-capability', { detail: { leaveEnabled: false } }));
      return null;
    }
    const data = checked(result);
    if (!data || data.version !== 1 || typeof data.leaveEnabled !== 'boolean') fail(503,'Chưa xác minh được quyền xử lý đơn nghỉ.');
    root.dispatchEvent(new CustomEvent('leave-capability', { detail: { leaveEnabled: data.leaveEnabled } }));
    return data;
  }
  function rememberAttendance(actorId, data) {
    const prefix = `${actorId}|${data.date}|${data.shift}|`;
    for (const key of attendanceSnapshots.keys())
      if (!key.startsWith(`${actorId}|${data.date}|`) || key.startsWith(prefix)) attendanceSnapshots.delete(key);
    for (const row of data.records) {
      if (!uuid(row.profileId) || !/^\d{6,20}$/.test(row.userId || '') || !Number.isSafeInteger(row.recordRevision)
        || (row.recordId === null ? row.recordRevision < 0 : !uuid(row.recordId) || row.recordRevision < 1)) continue;
      attendanceSnapshots.set(prefix + row.userId, { profileId:row.profileId,date:data.date,
        recordId:row.recordId,revision:row.recordRevision });
    }
  }
  async function adjustAttendance(path, body, current) {
    const capability = await client.rpc('get_admin_attendance_capabilities');
    if (capability.error && ['PGRST202','42501'].includes(capability.error.code))
      return response({success:false,message:'Điều chỉnh điểm danh đang chờ cập nhật bảo mật; chưa có dữ liệu được sửa.'},503);
    const caps = checked(capability);
    if (caps?.version !== 1 || caps.profileId !== current.id || caps.editingEnabled !== true)
      return response({success:false,message:maintenance},503);
    if (!/^\d{6,20}$/.test(body.userId || '') || !['Sáng','Chiều','Tối'].includes(body.shift)
      || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0
      || (body.expectedId !== null && (!uuid(body.expectedId) || body.expectedRevision < 1)))
      fail(400,'Thiếu phiên bản điểm danh đã xem. Tải lại bảng trước khi thao tác.');
    if (body.businessDate !== caps.businessDate) fail(409,'Bảng không còn thuộc ngày hiện tại. Tải lại bảng điểm danh.');
    const key = `${current.id}|${caps.businessDate}|${body.shift}|${body.userId}`;
    const observed = attendanceSnapshots.get(key);
    if (!observed || observed.recordId !== body.expectedId || observed.revision !== body.expectedRevision)
      fail(409,'Dữ liệu đã thay đổi hoặc chưa được tải. Tải lại bảng điểm danh trước khi thao tác.');
    const actions = {'Vắng có phép':'mark_excused','Có mặt':'mark_on_time','Chưa điểm danh':'cancel_excused'};
    const action = path.endsWith('/cancel') ? 'cancel_scan' : Object.hasOwn(actions,body.newStatus) ? actions[body.newStatus] : null;
    if (!action) fail(400,'Thao tác điểm danh không hợp lệ.');
    const labels = {mark_excused:'Admin chọn Xin phép/Vắng CP từ bảng điểm danh.',mark_on_time:'Admin chọn Đúng giờ từ bảng điểm danh.',
      cancel_excused:'Admin chọn Hủy phép từ bảng điểm danh.',cancel_scan:'Admin xác nhận Hủy quét từ bảng điểm danh.'};
    const reason = body.reason === undefined ? labels[action] : body.reason;
    if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 500) fail(400,'Lý do thao tác chưa hợp lệ.');
    if (attendanceWrites.has(key)) fail(409,'Thao tác đang xử lý. Chờ kết quả rồi tải lại bảng.');
    attendanceWrites.add(key); attendanceSnapshots.delete(key);
    try {
      const result = await qrRpc('admin_adjust_attendance',{p_profile_id:observed.profileId,p_date:observed.date,
        p_shift:body.shift,p_action:action,p_expected_id:observed.recordId,p_expected_revision:observed.revision,p_reason:reason.trim()});
      if (result?.success !== true || result.profileId !== observed.profileId || result.studentId !== body.userId
        || result.date !== observed.date || result.shift !== body.shift || result.action !== action || typeof result.removed !== 'boolean'
        || (result.removed ? result.recordId !== null || !Number.isSafeInteger(result.recordRevision) || result.recordRevision < 1
          : !uuid(result.recordId) || result.recordRevision !== (observed.recordId === null ? 1 : observed.revision+1)))
        fail(503,'Chưa xác nhận được kết quả. Tải lại bảng điểm danh để kiểm tra trước khi thử lại.');
      return response({success:true,message:result.removed?'Đã hủy bản ghi được chọn.':'Đã điều chỉnh bản ghi được chọn.',data:result});
    } finally { attendanceWrites.delete(key); }
  }
  async function identity(admin = true) {
    const result = await client.auth.getUser();
    if (result.error || !result.data?.user) fail(401, 'Vui lòng đăng nhập bằng Supabase Auth.');
    let selected = await client.from('profiles').select(fields).eq('id', result.data.user.id).eq('active', true).maybeSingle();
    if (selected.error && ['42703','PGRST204'].includes(selected.error.code)) {
      fields = baseFields;
      selected = await client.from('profiles').select(fields).eq('id', result.data.user.id).eq('active', true).maybeSingle();
    }
    const profile = checked(selected);
    if (!profile || (admin && !roles.includes(profile.role))) fail(403, 'Tài khoản không có quyền thực hiện thao tác này.');
    return profile;
  }
  function sessionReply(profile) {
    return { success: true, csrfToken: 'supabase-auth', data: { userId: profile.student_id,
      name: profile.display_name, role: profile.role === 'super_admin' ? 'superadmin' : profile.role } };
  }
  async function readAll(table, columns, filters = {}) {
    const rows = [];
    for (let offset = 0; offset < 10000; offset += 500) {
      let query = client.from(table).select(columns);
      for (const [key, value] of Object.entries(filters)) query = query.eq(key, value);
      query = query.order(table === 'profiles' ? 'student_id' : 'profile_id');
      if (table === 'attendance') query = query.order('business_date').order('shift');
      const page = checked(await query.range(offset, offset + 499));
      rows.push(...(page || []));
      if ((page || []).length < 500) return rows;
    }
    fail(503, 'Dữ liệu vượt giới hạn tải của giao diện hiện tại. Cần bổ sung báo cáo phân trang.');
  }
  async function refreshProfiles() { profiles = await readAll('profiles', fields); return profiles; }
  function today(now = new Date()) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(now).map(part => [part.type, part.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
  }
  function date(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) fail(400, 'Ngày không hợp lệ.');
    const parsed = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) fail(400, 'Ngày không hợp lệ.');
    return parsed;
  }
  function week(value = today().date) {
    const start = date(value); start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
    const end = new Date(start); end.setUTCDate(end.getUTCDate() + 6);
    return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
  }
  function emptySchedule() { return Object.fromEntries(['t2','t3','t4','t5','t6','t7','cn'].map(day => [day, []])); }
  function canonicalSchedule(value) {
    const days = Object.keys(emptySchedule()), shifts = ['Sáng','Chiều','Tối'];
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(day => !days.includes(day))) fail(400,'Lịch tuần không hợp lệ.');
    const result = {};
    for (const day of days) {
      const entries = value[day] === undefined ? [] : value[day];
      if (!Array.isArray(entries) || entries.some(shift => typeof shift !== 'string'
        || !shifts.some(label => label.toLocaleLowerCase('vi') === shift.trim().toLocaleLowerCase('vi')))) fail(400,'Ca trong lịch tuần không hợp lệ.');
      result[day] = shifts.filter(label => entries.some(shift => label.toLocaleLowerCase('vi') === shift.trim().toLocaleLowerCase('vi')));
    }
    return result;
  }
  async function writeSchedule(path, body) {
    if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0) fail(400,'Thiếu phiên bản lịch đã đọc. Tải lại lịch trước khi sửa.');
    const selected = week(body.week);
    if (body.week !== selected.start) fail(400,'Tuần phải bắt đầu từ thứ hai.');
    if (typeof body.userId !== 'string' || !/^\d{6,20}$/.test(body.userId)) fail(400,'Mã sinh viên không hợp lệ.');
    const target = checked(await client.from('profiles').select(fields).eq('student_id',body.userId).eq('active',true).maybeSingle());
    if (!target || target.student_id !== body.userId || !target.active) fail(404,'Không tìm thấy hồ sơ đang hoạt động.');
    const reason = body.reason === undefined ? (path.endsWith('/rollback') ? 'Khôi phục phiên bản từ lịch sử trên dashboard.' : 'Cập nhật lịch tuần từ dashboard.') : body.reason;
    if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 500) fail(400,'Lý do thay đổi cần từ 1 đến 500 ký tự.');
    let result, requestedSchedule;
    if (path.endsWith('/rollback')) {
      if (!Number.isSafeInteger(body.revision) || body.revision < 1) fail(400,'Phiên bản cần khôi phục không hợp lệ.');
      result = await qrRpc('admin_rollback_week_schedule',{ p_profile_id:target.id,p_week_start:selected.start,
        p_revision:body.revision,p_expected_revision:body.expectedRevision,p_reason:reason.trim() });
    } else {
      requestedSchedule = canonicalSchedule(body.schedule);
      result = await qrRpc('admin_save_week_schedule',{ p_profile_id:target.id,p_week_start:selected.start,
        p_schedule:requestedSchedule,p_expected_revision:body.expectedRevision,p_reason:reason.trim() });
    }
    if (!result || result.profile_id !== target.id || result.week_start !== selected.start
      || !Number.isSafeInteger(result.revision) || result.revision < 1 || !['manual','rollback','lhu','migration'].includes(result.source))
      fail(503,'Chưa xác nhận được lịch đã lưu. Tải lại dữ liệu để kiểm tra trước khi thử lại.');
    const schedule = canonicalSchedule(result.schedule);
    if ((path.endsWith('/rollback') && result.revision !== body.expectedRevision + 1)
      || (!path.endsWith('/rollback') && ![body.expectedRevision,body.expectedRevision + 1].includes(result.revision))
      || (requestedSchedule && JSON.stringify(requestedSchedule) !== JSON.stringify(schedule)))
      fail(503,'Kết quả lịch chưa khớp yêu cầu. Tải lại dữ liệu để đối chiếu.');
    return response({success:true,data:{userId:target.student_id,schedule,
      scheduleWeek:{revision:result.revision,source:result.source,updatedAt:result.updated_at}},metadata:{week:selected}});
  }
  function profileLabel(id) { const p = profiles.find(row => row.id === id); return p ? `${p.display_name} (${p.student_id})` : 'Không xác định'; }
  function publicLeave(row) {
    return { id: row.id, userId: row.student_id, userName: row.user_name,
      department: row.department || '', date: row.date, shift: row.shift, reason: row.reason,
      status: row.status, reviewedBy: row.reviewed_by, reviewedByName: row.reviewed_by_name,
      reviewedAt: row.reviewed_at, reviewReason: row.review_reason, createdAt: row.created_at,
      profileId: row.profile_id, revision: Number.isSafeInteger(row.revision) ? row.revision : null };
  }
  function shiftRows(shift, stamp, schedules, records) {
    const dayKey = ['cn','t2','t3','t4','t5','t6','t7'][date(stamp).getUTCDay()];
    const scheduleMap = new Map(schedules.map(row => [row.profile_id, row.schedule]));
    const attMap = new Map(records.filter(row => row.shift === shift).map(row => [row.profile_id, row]));
    return profiles.filter(p => p.active && p.role === 'student').flatMap(p => {
      const schedule = scheduleMap.get(p.id), att = attMap.get(p.id);
      const expected = Array.isArray(schedule?.[dayKey]) && schedule[dayKey].includes(shift);
      if (schedule && !expected && !att) return [];
      return [{ userId: p.student_id, userName: p.display_name, department: p.department || '', profileId: p.id,
        shift, status: att?.status || (schedule ? 'Chưa điểm danh' : 'Chưa có lịch'),
        timestamp: att?.scanned_at || null, inSchedule: expected,
        isLocked: Boolean(att?.is_locked), reason: att?.note || '', note: att?.note || '' }];
    });
  }
  async function zaloRpc(name,args) {
    const result=await client.rpc(name,args);
    if(result.error){
      const messages={APP_ZALO_DISABLED:'Zalo chưa bật gửi thật hoặc hệ thống đang thử QR.',
        APP_ZALO_REPORT_NOT_READY:'Ca chưa đủ điều kiện tạo báo cáo. Kiểm tra giờ và trạng thái chốt ca.',
        APP_ZALO_REPORT_TOO_LONG:'Báo cáo vượt giới hạn 2.000 ký tự; chưa tạo yêu cầu gửi.',
        APP_FORBIDDEN:'Tài khoản không có quyền gửi báo cáo Zalo.'};
      const code=Object.keys(messages).find(k=>String(result.error.message||'').includes(k));
      fail(code==='APP_FORBIDDEN'?403:409,code?messages[code]:'Chưa xác nhận được yêu cầu Zalo. Kiểm tra trạng thái trước khi thử lại.');
    }
    const data=result.data;
    if(!data || !uuid(data.id) || !['pending','sending','sent','failed','unknown','cancelled'].includes(data.status)
      || data.sent!==(data.status==='sent'))fail(503,'Chưa xác nhận được trạng thái gửi Zalo.');
    return response({success:true,data,sent:data.sent});
  }
  async function handle(url, options) {
    const path = url.pathname, method = (options.method || 'GET').toUpperCase();
    if (path === '/api/admin/login' && method === 'POST') {
      const body = JSON.parse(options.body || '{}');
      const identifier = String(body.userId || '').trim();
      const email = /^\d{6,20}$/.test(identifier) ? `${identifier}@student.lhu.edu.vn` : identifier;
      if (!email || typeof body.password !== 'string' || !body.password) fail(400, 'Thiếu thông tin đăng nhập.');
      const result = await client.auth.signInWithPassword({ email, password: body.password });
      if (result.error) fail(401, 'Email/MSSV hoặc mật khẩu chưa đúng, hoặc tài khoản chưa được xác nhận.');
      return response(sessionReply(await identity()));
    }
    if (path === '/api/admin/logout' && method === 'POST') {
      const result = await client.auth.signOut({ scope: 'local' });
      if (result.error) fail(503, 'Chưa đăng xuất được. Vui lòng thử lại.');
      profiles = [];
      attendanceSnapshots.clear();
      for (const key of ['adminUser','adminName','adminRole','adminPass']) root.localStorage.removeItem(key);
      return response({ success: true, message: 'Đã đăng xuất.' });
    }
    // Quyền được xác minh từ Auth + profile cho mỗi request; không tin storage hiển thị.
    const current = await identity(path !== '/api/leaves/mine');
    if (path === '/api/admin/verify' || path === '/api/admin/check') return response(sessionReply(current));
    if(path==='/api/attendance/force-zalo-report' && method==='POST'){
      const body=JSON.parse(options.body||'{}');
      if(!['Sáng','Chiều','Tối'].includes(body.shift))fail(400,'Ca không hợp lệ.');
      const mode=checked(await client.rpc('get_qr_test_mode'));
      if(mode?.version!==1 || mode.profileId!==current.id || typeof mode.testMode!=='boolean'
        || !Number.isFinite(Date.parse(mode.serverTime)))fail(503,'Chưa xác minh được giờ và chế độ điểm danh.');
      if(mode.testMode)fail(409,'Đang thử QR; chưa gửi báo cáo Zalo thật.');
      const stamp=today(new Date(mode.serverTime)).date;
      const preview=checked(await client.rpc('admin_preview_zalo_report',{p_date:stamp,p_shift:body.shift,p_type:'closing'}));
      if(preview?.version!==1 || typeof preview.ready!=='boolean')fail(503,'Chưa xác minh được báo cáo.');
      if(['TEST_MODE','MAINTENANCE'].includes(preview.reason))fail(409,'Đang thử QR hoặc bảo trì; chưa gửi báo cáo Zalo thật.');
      return zaloRpc('admin_enqueue_zalo_report',{p_date:stamp,p_shift:body.shift,p_type:preview.ready?'closing':'early'});
    }
    if(path==='/api/attendance/zalo-delivery' && method==='GET'){
      const id=url.searchParams.get('id');if(!uuid(id))fail(400,'Mã yêu cầu Zalo không hợp lệ.');
      return zaloRpc('admin_get_zalo_delivery',{p_id:id});
    }
    if ((path === '/api/attendance/update-status' && method === 'POST') || (path === '/api/attendance/cancel' && method === 'DELETE')) {
      return adjustAttendance(path,JSON.parse(options.body || '{}'),current);
    }
    if (method === 'POST' && ['/api/schedule','/api/schedule/rollback'].includes(path)) {
      return writeSchedule(path, JSON.parse(options.body || '{}'));
    }
    const reviewMatch = /^\/api\/leaves\/([0-9a-f-]{36})\/review$/.exec(path);
    if (reviewMatch && method === 'POST') {
      const caps = await leaveCapabilities();
      if (!caps?.leaveEnabled || !caps.canReview) return response({ success: false, message: maintenance }, 503);
      const body = JSON.parse(options.body || '{}');
      if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 1
        || !['approved','rejected','pending'].includes(body.decision) || typeof body.reason !== 'string') fail(400,'Quyết định chưa hợp lệ.');
      const result = await qrRpc('admin_decide_leave_request', { p_leave_id: reviewMatch[1],
        p_decision: body.decision, p_reason: body.reason, p_expected_revision: body.expectedRevision });
      if (result?.success !== true || result.data?.id !== reviewMatch[1] || result.data?.status !== body.decision
        || result.data?.revision !== body.expectedRevision + 1) fail(503,'Chưa xác nhận được kết quả. Tải lại danh sách trước khi thử lại.');
      return response({ success: true, message: body.decision === 'approved' ? 'Đã chấp thuận đơn nghỉ.'
        : body.decision === 'rejected' ? 'Đã từ chối đơn nghỉ.' : 'Đã hủy duyệt; dữ liệu điểm danh được đối chiếu trước khi hoàn tác.',
        data: publicLeave(result.data) });
    }
    if (path === '/api/get-qr-token' && method === 'GET') {
      const caps = await qrCapabilities();
      if (!caps?.qrEnabled) return response({ success: false, message: maintenance }, 503);
      const data = await qrRpc('admin_get_active_qr');
      if (data?.isPaused) {
        return response({ success: true, isPaused: true, shift: data.shift, date: data.date, message: data.message || 'Mã QR đang tạm dừng phát.' });
      }
      if (!data || !/^[a-f0-9]{32}$/.test(data.token) || !data.expiresAt || !data.serverTime) fail(503,'Chưa nhận được mã QR hợp lệ.');
      return response({ success: true, ...data });
    }
    if (path === '/api/attendance/toggle-qr' && method === 'POST') {
      const caps = await qrCapabilities();
      if (!caps?.qrEnabled) return response({ success: false, message: maintenance }, 503);
      const body = JSON.parse(options.body || '{}');
      const data = await qrRpc('admin_toggle_qr_pause', {
        p_paused: Boolean(body.paused),
        p_reason: body.reason || ''
      });
      if (data?.success !== true) fail(503, 'Chưa thay đổi được trạng thái phát QR.');
      return response({ success: true, isPaused: data.isPaused, message: data.message, data });
    }
    if (method === 'POST' && ['/api/users/reset-device','/api/attendance/close-session'].includes(path)) {
      const caps = await qrCapabilities();
      if (!caps?.qrEnabled) return response({ success: false, message: maintenance }, 503);
      const body = JSON.parse(options.body || '{}');
      if (path === '/api/users/reset-device') {
        if (path !== '/api/attendance/stats/all') await refreshProfiles();
        const target = profiles.find(p => p.student_id === body.userId);
        if (!target) fail(404,'Không tìm thấy hồ sơ.');
        const data = await qrRpc('admin_reset_device', { p_profile_id: target.id, p_reason: body.reason || 'Quản trị viên xác nhận mở khóa thiết bị trên dashboard.' });
        if (data?.success !== true || data.profileId !== target.id) fail(503,'Chưa xác nhận được kết quả mở khóa.');
        return response({ success: true, message: 'Đã mở khóa thiết bị. Sinh viên cần xác minh lại trình duyệt.' });
      }
      date(body.date);
      const data = await qrRpc('admin_close_attendance_session', { p_date: body.date, p_shift: body.shift, p_reason: body.reason });
      if (data?.closed !== true) fail(503,'Chưa xác nhận được kết quả chốt ca.');
      return response({ success: true, message: data.testMode ? 'Đã chốt phiên thử; dữ liệu điểm danh thật không thay đổi.' : 'Đã chốt và khóa các bản ghi trong ca.', data });
    }
    if (path === '/api/admin/sync-schedule' && ['GET','POST'].includes(method)) {
      const body = method === 'POST' ? JSON.parse(options.body || '{}') : {};
      const action = method === 'GET' ? 'status' : body.action === 'apply' ? 'apply' : 'preview';
      if (!client.functions?.invoke) fail(503,'Chưa cấu hình Edge worker đồng bộ LHU.');
      const result = await client.functions.invoke('lhu-sync-worker',{body:{action,week:body.week,jobId:body.jobId}});
      if (result.error) {
        let info;try { info = await result.error.context?.json(); } catch { /* generic fallback */ }
        const status = result.error.context?.status;
        fail([401,403,409].includes(status) ? status : 503,info?.message || 'Chưa kết nối được worker LHU. Cần triển khai Edge Function và Cron.');
      }
      if (!result.data?.success) fail(503,result.data?.message || 'Chưa xác minh được kết quả đồng bộ LHU.');
      const payload = result.data.data;
      if (action === 'status') return response({success:true,data:payload?.job || null,configured:payload?.configured === true,workerSeenAt:payload?.workerSeenAt});
      return response({success:true,data:payload});
    }
    if (method !== 'GET') return response({ success: false, code: 'WRITE_MAINTENANCE', message: maintenance }, 503);
    if (['/api/admin/sync-schedule','/api/schedule/sync'].includes(path)) {
      return response({ success: false, code: 'WRITE_MAINTENANCE', message: maintenance }, 503);
    }
    if (path === '/api/leaves/mine') {
      const rows = checked(await client.from('leave_requests').select('*').eq('profile_id', current.id)
        .order('created_at', { ascending: false }).limit(50));
      return response({ success: true, data: (rows || []).map(publicLeave) });
    }
    const allowed = ['/api/users','/api/schedule','/api/schedule/history','/api/attendance/today',
      '/api/attendance/daily-summary','/api/attendance/stats/all','/api/admin/audit-logs','/api/leaves','/api/attendance'];
    if (!allowed.includes(path)) return response({ success: false, message: 'API này chưa được triển khai.' }, 404);
    if (path !== '/api/attendance/stats/all') await refreshProfiles();
    if (path === '/api/users' || path === '/api/schedule') {
      const selected = week(url.searchParams.get('week') || today().date);
      const schedules = await readAll('weekly_schedules','profile_id,week_start,schedule,revision,source', { week_start: selected.start });
      const map = new Map(schedules.map(row => [row.profile_id, row]));
      const devices = await readAll('devices','profile_id');
      const bound = new Set(devices.map(row => row.profile_id));
      const data = profiles.filter(p => path === '/api/users' || (p.active && p.role === 'student')).map(p => ({ _id: p.id, id: p.id, userId: p.student_id, name: p.display_name,
        role: p.role === 'super_admin' ? 'superadmin' : p.role, active: p.active, department: p.department || '',
        deviceBound: bound.has(p.id), schedule: map.get(p.id)?.schedule || emptySchedule(),
        scheduleWeek: { revision: map.get(p.id)?.revision || 0, source: map.get(p.id)?.source || 'missing' } }));
      return response({ success: true, count: data.length, studentCount: profiles.filter(p => p.active && p.role === 'student').length, data, metadata: { week: selected } });
    }
    if (path === '/api/schedule/history') {
      const p = profiles.find(row => row.student_id === url.searchParams.get('userId'));
      if (!p) fail(404, 'Không tìm thấy hồ sơ.');
      const selected = week(url.searchParams.get('week') || today().date);
      const schedule = checked(await client.from('weekly_schedules').select('revision')
        .eq('profile_id', p.id).eq('week_start', selected.start).maybeSingle());
      const history = checked(await client.from('weekly_schedule_revisions').select('revision,schedule,source,actor_id,reason,created_at')
        .eq('profile_id', p.id).eq('week_start', selected.start).order('revision', { ascending: false }).limit(50));
      return response({ success: true, data: { week: selected, currentRevision: schedule?.revision || 0,
        revisions: (history || []).map(row => ({ ...row, actorId: profileLabel(row.actor_id), changedAt: row.created_at })) } });
    }
    if (path === '/api/attendance/today' || path === '/api/attendance/daily-summary') {
      const caps = await qrCapabilities();
      const clock = caps ? today(new Date(caps.serverTime)) : today();
      const rawDate = url.searchParams.get('date');
      const targetDate = rawDate ? (date(rawDate), rawDate) : clock.date;
      const selected = week(targetDate);
      if (caps?.qrEnabled) {
        const shift = url.searchParams.get('shift') || (clock.minutes < 720 ? 'Sáng' : clock.minutes < 1080 ? 'Chiều' : 'Tối');
        if (!['Sáng','Chiều','Tối'].includes(shift)) fail(400,'Ca không hợp lệ.');
        if (path.endsWith('/today')) {
          const data = await qrRpc('admin_get_shift_attendance',{p_date:targetDate,p_shift:shift});
          if (!Array.isArray(data?.records)) fail(503,'Chưa tải được danh sách phiên điểm danh.');
          rememberAttendance(current.id,data);
          return response({success:true,...data,data:data.records.map(row=>({...row,department:profiles.find(p=>p.id===row.profileId)?.department || row.department || '',businessDate:data.date}))});
        }
        const details = [];
        for (const label of ['Sáng','Chiều','Tối']) {
          const data = await qrRpc('admin_get_shift_attendance',{p_date:targetDate,p_shift:label});
          if (!Array.isArray(data?.records)) fail(503,'Chưa tải đủ dữ liệu tổng kết.');
          details.push(...data.records);
        }
        return response({ success:true,dateStr:targetDate.split('-').reverse().join('/'),
          dayName:new Intl.DateTimeFormat('vi-VN',{weekday:'long',timeZone:'Asia/Ho_Chi_Minh'}).format(new Date(targetDate === clock.date ? caps.serverTime : `${targetDate}T12:00:00+07:00`)),
          totalExpected:details.filter(r=>r.inSchedule).length,totalPresent:details.filter(r=>r.status==='Có mặt').length,
          totalLate:details.filter(r=>r.status==='Đi trễ').length,totalExcused:details.filter(r=>r.status==='Vắng có phép').length,
          totalUnexcused:details.filter(r=>r.status==='Vắng không phép').length,details });
      }
      const schedules = await readAll('weekly_schedules','profile_id,schedule', { week_start: selected.start });
      const records = await readAll('attendance','profile_id,student_id,business_date,shift,status,scanned_at,is_locked,note', { business_date: targetDate });
      if (path.endsWith('/today')) {
        const shift = url.searchParams.get('shift') || (clock.minutes < 720 ? 'Sáng' : clock.minutes < 1080 ? 'Chiều' : 'Tối');
        if (!['Sáng','Chiều','Tối'].includes(shift)) fail(400, 'Ca không hợp lệ.');
        const data = shiftRows(shift, targetDate, schedules, records);
        const [cutoff, closing] = shift === 'Sáng' ? [510,660] : shift === 'Chiều' ? [810,1020] : [1110,1320];
        const isClosed = targetDate < clock.date ? true : targetDate > clock.date ? false : clock.minutes >= closing;
        const isPastCutoff = targetDate < clock.date ? true : targetDate > clock.date ? false : clock.minutes > cutoff;
        return response({ success: true, date: targetDate, data, shift, isClosed,
          isPastCutoff, cutoffTimeStr: shift === 'Sáng' ? '08:30' : shift === 'Chiều' ? '13:30' : '18:30',
          closingTimeStr: shift === 'Sáng' ? '11:00' : shift === 'Chiều' ? '17:00' : '22:00',
          stats: { total: data.length, present: data.filter(r => r.status === 'Có mặt').length,
            late: data.filter(r => r.status === 'Đi trễ').length,
            absentWithLeave: data.filter(r => r.status === 'Vắng có phép').length,
            absentWithoutLeave: data.filter(r => r.status === 'Vắng không phép').length,
            waiting: data.filter(r => r.status === 'Chưa điểm danh').length } });
      }
      const details = ['Sáng','Chiều','Tối'].flatMap(shift => shiftRows(shift, clock.date, schedules, records));
      return response({ success: true, dateStr: clock.date.split('-').reverse().join('/'),
        dayName: new Intl.DateTimeFormat('vi-VN',{weekday:'long',timeZone:'Asia/Ho_Chi_Minh'}).format(new Date()),
        totalExpected: details.filter(r => r.inSchedule).length,
        totalPresent: details.filter(r => r.status === 'Có mặt').length,
        totalLate: details.filter(r => r.status === 'Đi trễ').length,
        totalExcused: details.filter(r => r.status === 'Vắng có phép').length,
        totalUnexcused: details.filter(r => r.status === 'Vắng không phép').length, details });
    }
    if (path === '/api/attendance/stats/all') {
      const mode = root.AttendanceTrialRouter ? checked(await root.AttendanceTrialRouter.mode(client)) : null;
      if (mode?.testMode) {
        const data = checked(await client.rpc('qr_test_admin_get_stats'));
        if (!Array.isArray(data)) fail(503,'Chưa tải được thống kê thử.');
        return response({success:true,testMode:true,count:data.length,data});
      }
      if (typeof client.rpc === 'function') {
        try {
          const rpcRes = await client.rpc('admin_get_attendance_stats');
          if (!rpcRes?.error && Array.isArray(rpcRes?.data)) {
            return response({ success: true, count: rpcRes.data.length, data: rpcRes.data });
          }
          if (rpcRes?.error && rpcRes.error.code !== 'PGRST202') checked(rpcRes);
        } catch (err) {
          if (err?.status) throw err;
        }
      }
      await refreshProfiles();
      const records = await readAll('attendance','profile_id,status');
      const data = profiles.filter(p => p.active && p.role === 'student').map(p => {
        const rows = records.filter(row => row.profile_id === p.id);
        return { userId: p.student_id, name: p.display_name, department: p.department || '', total: rows.length,
          present: rows.filter(r => r.status === 'Có mặt').length, late: rows.filter(r => r.status === 'Đi trễ').length,
          excused: rows.filter(r => r.status === 'Vắng có phép').length,
          unexcused: rows.filter(r => r.status === 'Vắng không phép').length };
      });
      return response({ success: true, count: data.length, data });
    }
    if (path === '/api/leaves') {
      const page = Number(url.searchParams.get('page') || 1), limit = Number(url.searchParams.get('limit') || 25);
      if (!Number.isSafeInteger(page) || page < 1 || page > 10000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail(400, 'Phân trang không hợp lệ.');
      let q = client.from('leave_requests').select('*', { count: 'exact' });
      const status = url.searchParams.get('status');
      if (status && !['pending','reviewing','approved','rejected','all'].includes(status)) fail(400,'Trạng thái lọc không hợp lệ.');
      const caps = await leaveCapabilities();
      if (status && status !== 'all') q = q.eq('status', status);
      const result = await q.order('created_at', { ascending: false }).order('id', { ascending: false }).range((page-1)*limit, page*limit-1);
      const rows = checked(result) || [], total = result.count || 0;
      return response({ success: true, data: rows.map(publicLeave), total, page, pages: Math.max(1,Math.ceil(total/limit)),
        leaveEnabled: caps?.leaveEnabled === true, canReview: caps?.canReview === true, profileId: current.id });
    }
    if (path === '/api/admin/audit-logs') {
      const page = Number(url.searchParams.get('page') || 1), limit = 20;
      if (!Number.isSafeInteger(page) || page < 1 || page > 10000) fail(400, 'Phân trang không hợp lệ.');
      let q = client.from('audit_logs').select('id,actor_id,target_id,action,details,created_at', { count: 'exact' });
      for (const [filter, column] of [['actorId','actor_id'],['targetId','target_id']]) {
        const value = url.searchParams.get(filter)?.trim();
        if (!value) continue;
        const matches = profiles.filter(p => p.student_id === value || p.id === value || p.display_name.toLocaleLowerCase('vi').includes(value.toLocaleLowerCase('vi')));
        if (!matches.length) return response({ success: true, data: [], total: 0, page, pages: 1 });
        q = q.in(column, matches.map(p => p.id));
      }
      const from = url.searchParams.get('from'), to = url.searchParams.get('to');
      if (from) { date(from); q = q.gte('created_at', `${from}T00:00:00+07:00`); }
      if (to) { date(to); q = q.lte('created_at', `${to}T23:59:59.999999+07:00`); }
      const result = await q.order('created_at', { ascending: false }).order('id', { ascending: false }).range((page-1)*limit, page*limit-1);
      const rows = checked(result) || [], total = result.count || 0;
      return response({ success: true, total, page, pages: Math.max(1,Math.ceil(total/limit)),
        data: rows.map(row => ({ id: row.id, action: row.action, actorId: profileLabel(row.actor_id),
          targetId: row.target_id ? profileLabel(row.target_id) : 'Hệ thống',
          reason: row.details?.reason || row.details?.reviewReason || '', createdAt: row.created_at })) });
    }
    return response({ success: false, message: 'API này chưa được triển khai.' }, 404);
  }
  root.fetch = async function (input, options = {}) {
    const url = new URL(typeof input === 'string' ? input : input.url, root.location.href);
    if (url.origin !== root.location.origin || !url.pathname.startsWith('/api/')) return networkFetch(input, options);
    try { return await handle(url, options); }
    catch (error) { return response({ success: false, message: error.status ? error.message : 'Không hoàn tất được yêu cầu. Kiểm tra kết nối rồi thử lại.' }, error.status || 503); }
  };
})(globalThis);
