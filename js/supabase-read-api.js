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
  const networkFetch = root.fetch.bind(root);
  const roles = ['admin', 'super_admin'];
  const maintenance = 'Hệ thống đang giới hạn ghi để cập nhật bảo mật. Chức năng này tạm dừng; chưa có dữ liệu được ghi.';
  const fields = 'id,student_id,display_name,role,active,updated_at';
  let profiles = [];
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
  async function identity(admin = true) {
    const result = await client.auth.getUser();
    if (result.error || !result.data?.user) fail(401, 'Vui lòng đăng nhập bằng Supabase Auth.');
    const profile = checked(await client.from('profiles').select(fields)
      .eq('id', result.data.user.id).eq('active', true).maybeSingle());
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
    return profiles.filter(p => p.active).flatMap(p => {
      const schedule = scheduleMap.get(p.id), att = attMap.get(p.id);
      const expected = Array.isArray(schedule?.[dayKey]) && schedule[dayKey].includes(shift);
      if (schedule && !expected && !att) return [];
      return [{ userId: p.student_id, userName: p.display_name, department: '', profileId: p.id,
        shift, status: att?.status || (schedule ? 'Chưa điểm danh' : 'Chưa có lịch'),
        timestamp: att?.scanned_at || null, inSchedule: expected,
        isLocked: Boolean(att?.is_locked), reason: att?.note || '', note: att?.note || '' }];
    });
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
      for (const key of ['adminUser','adminName','adminRole','adminPass']) root.localStorage.removeItem(key);
      return response({ success: true, message: 'Đã đăng xuất.' });
    }
    // Quyền được xác minh từ Auth + profile cho mỗi request; không tin storage hiển thị.
    const current = await identity(path !== '/api/leaves/mine');
    if (path === '/api/admin/verify' || path === '/api/admin/check') return response(sessionReply(current));
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
      if (!data || !/^[a-f0-9]{32}$/.test(data.token) || !data.expiresAt || !data.serverTime) fail(503,'Chưa nhận được mã QR hợp lệ.');
      return response({ success: true, ...data });
    }
    if (method === 'POST' && ['/api/users/reset-device','/api/attendance/close-session'].includes(path)) {
      const caps = await qrCapabilities();
      if (!caps?.qrEnabled) return response({ success: false, message: maintenance }, 503);
      const body = JSON.parse(options.body || '{}');
      if (path === '/api/users/reset-device') {
        await refreshProfiles();
        const target = profiles.find(p => p.student_id === body.userId);
        if (!target) fail(404,'Không tìm thấy hồ sơ.');
        const data = await qrRpc('admin_reset_device', { p_profile_id: target.id, p_reason: body.reason || 'Quản trị viên xác nhận mở khóa thiết bị trên dashboard.' });
        if (data?.success !== true || data.profileId !== target.id) fail(503,'Chưa xác nhận được kết quả mở khóa.');
        return response({ success: true, message: 'Đã mở khóa thiết bị. Sinh viên cần xác minh lại trình duyệt.' });
      }
      date(body.date);
      const data = await qrRpc('admin_close_attendance_session', { p_date: body.date, p_shift: body.shift, p_reason: body.reason });
      if (data?.closed !== true) fail(503,'Chưa xác nhận được kết quả chốt ca.');
      return response({ success: true, message: 'Đã chốt và khóa các bản ghi trong ca.', data });
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
    await refreshProfiles();
    if (path === '/api/users' || path === '/api/schedule') {
      const selected = week(url.searchParams.get('week') || today().date);
      const schedules = await readAll('weekly_schedules','profile_id,week_start,schedule,revision,source', { week_start: selected.start });
      const map = new Map(schedules.map(row => [row.profile_id, row]));
      const devices = await readAll('devices','profile_id');
      const bound = new Set(devices.map(row => row.profile_id));
      const data = profiles.map(p => ({ _id: p.id, id: p.id, userId: p.student_id, name: p.display_name,
        role: p.role === 'super_admin' ? 'superadmin' : p.role, active: p.active, department: '',
        deviceBound: bound.has(p.id), schedule: map.get(p.id)?.schedule || emptySchedule(),
        scheduleWeek: { revision: map.get(p.id)?.revision || 0, source: map.get(p.id)?.source || 'missing' } }));
      return response({ success: true, count: data.length, data, metadata: { week: selected } });
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
      const clock = caps ? today(new Date(caps.serverTime)) : today(), selected = week(clock.date);
      if (caps?.qrEnabled) {
        const shift = url.searchParams.get('shift') || (clock.minutes < 720 ? 'Sáng' : clock.minutes < 1080 ? 'Chiều' : 'Tối');
        if (!['Sáng','Chiều','Tối'].includes(shift)) fail(400,'Ca không hợp lệ.');
        if (path.endsWith('/today')) {
          const data = await qrRpc('admin_get_shift_attendance',{p_date:clock.date,p_shift:shift});
          if (!Array.isArray(data?.records)) fail(503,'Chưa tải được danh sách phiên điểm danh.');
          return response({success:true,...data,data:data.records});
        }
        const details = [];
        for (const label of ['Sáng','Chiều','Tối']) {
          const data = await qrRpc('admin_get_shift_attendance',{p_date:clock.date,p_shift:label});
          if (!Array.isArray(data?.records)) fail(503,'Chưa tải đủ dữ liệu tổng kết.');
          details.push(...data.records);
        }
        return response({ success:true,dateStr:clock.date.split('-').reverse().join('/'),
          dayName:new Intl.DateTimeFormat('vi-VN',{weekday:'long',timeZone:'Asia/Ho_Chi_Minh'}).format(new Date(caps.serverTime)),
          totalExpected:details.filter(r=>r.inSchedule).length,totalPresent:details.filter(r=>r.status==='Có mặt').length,
          totalLate:details.filter(r=>r.status==='Đi trễ').length,totalExcused:details.filter(r=>r.status==='Vắng có phép').length,
          totalUnexcused:details.filter(r=>r.status==='Vắng không phép').length,details });
      }
      const schedules = await readAll('weekly_schedules','profile_id,schedule', { week_start: selected.start });
      const records = await readAll('attendance','profile_id,student_id,business_date,shift,status,scanned_at,is_locked,note', { business_date: clock.date });
      if (path.endsWith('/today')) {
        const shift = url.searchParams.get('shift') || (clock.minutes < 720 ? 'Sáng' : clock.minutes < 1080 ? 'Chiều' : 'Tối');
        if (!['Sáng','Chiều','Tối'].includes(shift)) fail(400, 'Ca không hợp lệ.');
        const data = shiftRows(shift, clock.date, schedules, records);
        const [cutoff, closing] = shift === 'Sáng' ? [510,660] : shift === 'Chiều' ? [810,1020] : [1110,1320];
        return response({ success: true, data, shift, isClosed: clock.minutes >= closing,
          isPastCutoff: clock.minutes > cutoff, cutoffTimeStr: shift === 'Sáng' ? '08:30' : shift === 'Chiều' ? '13:30' : '18:30',
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
      const records = await readAll('attendance','profile_id,status');
      const data = profiles.map(p => {
        const rows = records.filter(row => row.profile_id === p.id);
        return { userId: p.student_id, name: p.display_name, department: '', total: rows.length,
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
