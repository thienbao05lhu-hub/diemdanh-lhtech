/**
 * scripts/zalo-cron.js
 * Tự động tạo và gửi báo cáo điểm danh Zalo Bot (Chạy trên GitHub Actions, Server hoặc Cron)
 */

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://oalnswbnjhkkovxjxtlz.supabase.co';
const ANON_KEY = process.env.SUPABASE_SERVER_KEY;
const ZALO_BOT_TOKEN = process.env.ZALO_BOT_TOKEN;
const ZALO_CHAT_ID = process.env.ZALO_CHAT_ID;

async function runCronReport(forcedType, forcedShift) {
  if (!ANON_KEY || ANON_KEY.startsWith('sb_publishable_') || !ZALO_BOT_TOKEN || (!ZALO_CHAT_ID && !process.env.ZALO_GROUP_CHAT_ID && !process.env.ZALO_CHAT_IDS)) {
    throw new Error('Thiếu credential server. Tác vụ Zalo đang tạm dừng.');
  }
  const vnNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
  const y = vnNow.getFullYear();
  const m = String(vnNow.getMonth() + 1).padStart(2, '0');
  const d = String(vnNow.getDate()).padStart(2, '0');
  const todayIso = `${y}-${m}-${d}`;
  const dateVnStr = `${d}/${m}/${y}`;
  const hours = vnNow.getHours();
  const minutes = vnNow.getMinutes();
  const totalMins = hours * 60 + minutes;
  const dayKeys = ['cn', 't2', 't3', 't4', 't5', 't6', 't7'];
  const dayKey = dayKeys[vnNow.getDay()];

  let shift = forcedShift;
  let reportType = forcedType;

  if (!shift || !reportType) {
    if (totalMins >= 495 && totalMins < 660) {
      shift = 'Sáng'; reportType = 'early';
    } else if (totalMins >= 660 && totalMins < 795) {
      shift = 'Sáng'; reportType = 'closing';
    } else if (totalMins >= 795 && totalMins < 1020) {
      shift = 'Chiều'; reportType = 'early';
    } else if (totalMins >= 1020 && totalMins < 1095) {
      shift = 'Chiều'; reportType = 'closing';
    } else if (totalMins >= 1095 && totalMins < 1320) {
      shift = 'Tối'; reportType = 'early';
    } else {
      shift = 'Tối'; reportType = 'closing';
    }
  }

  console.log(`[Zalo Cron] Ngày: ${todayIso} (${dateVnStr}) - Giờ VN: ${hours}:${String(minutes).padStart(2, '0')} - Ca: ${shift} - Loại: ${reportType}`);

  // 1. Lấy danh sách hồ sơ sinh viên
  const pRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=*&active=eq.true`, {
    headers: { 'apikey': ANON_KEY }
  });
  if (!pRes.ok) throw new Error('Không đọc được dữ liệu Supabase; chưa gửi Zalo.');
  const profiles = await pRes.json();

  // 2. Lấy dữ liệu điểm danh hôm nay theo ca
  const aRes = await fetch(`${SUPABASE_URL}/rest/v1/attendance?select=*&business_date=eq.${todayIso}&shift=eq.${encodeURIComponent(shift)}`, {
    headers: { 'apikey': ANON_KEY }
  });
  if (!aRes.ok) throw new Error('Không đọc được dữ liệu Supabase; chưa gửi Zalo.');
  const atts = await aRes.json();

  // 3. Lấy thời khóa biểu tuần này
  const day = vnNow.getDay();
  const diff = vnNow.getDate() - day + (day === 0 ? -6 : 1);
  const mon = new Date(vnNow);
  mon.setDate(diff);
  const monIso = `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, '0')}-${String(mon.getDate()).padStart(2, '0')}`;

  const sRes = await fetch(`${SUPABASE_URL}/rest/v1/weekly_schedules?select=*&week_start=eq.${monIso}`, {
    headers: { 'apikey': ANON_KEY }
  });
  if (!sRes.ok) throw new Error('Không đọc được dữ liệu Supabase; chưa gửi Zalo.');
  const scheds = await sRes.json();
  const schedMap = new Map((scheds || []).map(s => [s.profile_id, s.schedule]));
  const attMap = new Map(atts.map(a => [a.profile_id, a]));
  const shiftLower = shift.toLowerCase();

  // 4. Lọc sinh viên có lịch ca này
  const expectedProfiles = profiles.filter(p => {
    const userSched = schedMap.get(p.id);
    if (!userSched || !userSched[dayKey] || !Array.isArray(userSched[dayKey])) return true;
    return userSched[dayKey].map(s => String(s).toLowerCase()).includes(shiftLower);
  });

  const presentOnTime = atts.filter(a => a.status === 'Có mặt');
  const lateList = atts.filter(a => a.status === 'Đi trễ');
  const absentList = [];
  const processedProfileIds = new Set();

  expectedProfiles.forEach(p => {
    const att = attMap.get(p.id);
    const pName = (p.student_id === '123000896' || p.role === 'super_admin') ? 'Võ Huỳnh Thiên Bảo' : p.display_name;
    if (!att) {
      absentList.push({ name: pName, note: '' });
    } else if (att.status === 'Vắng có phép' || att.status === 'Vắng CP') {
      absentList.push({ name: pName, note: ' (Có phép)' });
    } else if (att.status === 'Vắng không phép' || att.status === 'Vắng KP') {
      absentList.push({ name: pName, note: '' });
    }
    processedProfileIds.add(p.id);
  });

  // Kiểm tra người vắng ngoài danh sách lịch
  atts.forEach(a => {
    if (!processedProfileIds.has(a.profile_id) && ['Vắng có phép', 'Vắng CP', 'Vắng không phép', 'Vắng KP'].includes(a.status)) {
      const p = profiles.find(x => x.id === a.profile_id);
      const pName = p ? ((p.student_id === '123000896' || p.role === 'super_admin') ? 'Võ Huỳnh Thiên Bảo' : p.display_name) : a.student_id;
      const note = (a.status === 'Vắng có phép' || a.status === 'Vắng CP') ? ' (Có phép)' : '';
      absentList.push({ name: pName, note });
      processedProfileIds.add(a.profile_id);
    }
  });

  // 5. Định dạng tin nhắn báo cáo
  const isClosing = reportType === 'closing';
  const reportTitle = isClosing ? 'BÁO CÁO CHỐT CA' : 'BÁO CÁO TỔNG HỢP ĐẦU CA';
  let reportMsg = `🔔 ${reportTitle} ${shift.toUpperCase()} (${dateVnStr})\n`;
  reportMsg += `- ✅ Có mặt đúng giờ: ${presentOnTime.length}\n`;

  if (lateList.length === 0) {
    reportMsg += `- ⚠️ Đi trễ: 0\n`;
  } else {
    reportMsg += `- ⚠️ Đi trễ: ${lateList.length}\n`;
    lateList.forEach((r, idx) => {
      const p = profiles.find(x => x.id === r.profile_id);
      const pName = p ? ((p.student_id === '123000896' || p.role === 'super_admin') ? 'Võ Huỳnh Thiên Bảo' : p.display_name) : r.student_id;
      reportMsg += `  ${idx + 1}. ${pName}\n`;
    });
  }

  if (absentList.length === 0) {
    reportMsg += `- ❌ Vắng mặt: 0 (Đủ quân số)`;
  } else {
    reportMsg += `- ❌ Vắng mặt: ${absentList.length}\n`;
    absentList.forEach((item, idx) => {
      reportMsg += `  ${idx + 1}. ${item.name}${item.note}\n`;
    });
    reportMsg = reportMsg.trimEnd();
  }

  console.log('[Zalo Cron] Đã tạo nội dung báo cáo; không ghi dữ liệu cá nhân vào log.');

  // 6. Gửi tin nhắn qua Zalo Bot API (Hỗ trợ gửi song song cả Zalo Cá Nhân và Nhóm Zalo)
  const targetChatIds = [
    ...(process.env.ZALO_CHAT_ID ? [process.env.ZALO_CHAT_ID] : []),
    ...(process.env.ZALO_GROUP_CHAT_ID ? [process.env.ZALO_GROUP_CHAT_ID] : []),
    ...(process.env.ZALO_CHAT_IDS ? process.env.ZALO_CHAT_IDS.split(',') : [])
  ].map(s => s.trim()).filter((id, idx, arr) => id && arr.indexOf(id) === idx);

  if (targetChatIds.length === 0 && ZALO_CHAT_ID) {
    targetChatIds.push(ZALO_CHAT_ID);
  }

  const endpoint = `https://bot-api.zaloplatforms.com/bot${ZALO_BOT_TOKEN}/sendMessage`;
  let sentCount = 0;
  for (const cid of targetChatIds) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: cid, text: reportMsg })
      });
      const data = await res.json();
      if (data.ok) {
        console.log(`✅ Gửi báo cáo thành công tới ${cid}! Message ID:`, data.result?.message_id);
        sentCount++;
      } else {
        console.error(`❌ Gửi tới ${cid} thất bại:`, data);
      }
    } catch (err) {
      console.error(`❌ Lỗi mạng khi gửi tới ${cid}:`, err.message);
    }
  }

  if (sentCount === 0) {
    throw new Error('Zalo chưa xác nhận gửi thành công tới bất kỳ nơi nhận nào.');
  }
}

const args = process.argv.slice(2);
runCronReport(args[0], args[1]).catch(() => { console.error('Tác vụ Zalo chưa hoàn tất. Kiểm tra cấu hình và quyền server.'); process.exitCode = 1; });

