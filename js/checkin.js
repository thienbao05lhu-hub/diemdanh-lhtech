/* Logic Auth/QR cho giao diện điểm danh gốc. Không thay bố cục hoặc CSS. */
(function(root) {
  'use strict';
  const api = root.Attendance;
  if (!api) {
    document.getElementById('registerScreen').classList.remove('hidden');
    const alert = document.getElementById('registerAlert');
    alert.classList.remove('hidden'); alert.textContent = 'Không tải được hệ thống. Vui lòng tải lại trang.';
    document.getElementById('btnRegister').disabled = true;
    root.handleRegisterDevice = event => event.preventDefault();
    return;
  }
  const el = id => document.getElementById(id);
  let current = null, caps = null, verified = false, busy = false, refreshing = false;
  let scanner = null, cameraOn = false, cameraStarting = false, deadline = 0, generation = 0, pendingToken = null;
  let stickyResult = false;
  const messages = {
    APP_OUTSIDE_WINDOW: 'Hiện ngoài giờ nhận điểm danh.', APP_SESSION_CLOSED: 'Ca điểm danh đã chốt.',
    APP_TEST_MODE_EXPIRED: 'Phiên thử đã hết hạn hoặc bị tắt. Tải lại trang để kiểm tra.',
    APP_DEVICE_IN_USE: 'Trình duyệt này đã gắn với tài khoản khác. Liên hệ quản trị viên để mở khóa.',
    APP_DEVICE_MISMATCH: 'Thiết bị không khớp. Dùng trình duyệt đã đăng ký hoặc liên hệ quản trị viên để mở khóa.',
  };
  const errorText = error => Object.entries(messages).find(([code]) => String(error?.message).includes(code))?.[1] || api.message(error);
  const rpc = async (name, args) => api.checkResult(await api.client.rpc(name,args)).data;
  function token() {
    const key = 'lhtech_device_token_v2';
    let value = root.localStorage.getItem(key);
    if (value && value.length >= 10 && value.length <= 255) return value;
    value = root.localStorage.getItem('qr_device_id') || root.localStorage.getItem('lhtech_device_fp');
    if (!value || value.length < 10 || value.length > 255) value = Array.from(root.crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('');
    root.localStorage.setItem(key,value); return value;
  }
  function ready() { return verified && caps?.qrEnabled === true && caps?.canScan === true && performance.now() < deadline; }
  function controls() {
    el('btnRegister').disabled = busy || caps?.qrEnabled !== true;
    el('btnResumeScan').disabled = busy || !ready() || cameraStarting;
  }
  function registration(message = '', error = false) {
    el('scannerScreen').classList.add('hidden'); el('registerScreen').classList.remove('hidden');
    const alert = el('registerAlert');
    alert.textContent = message;
    alert.className = `mt-4 p-3.5 rounded-xl text-xs font-medium border text-center ${error ? 'text-rose-300 border-rose-500/30 bg-rose-500/10' : 'text-amber-300 border-amber-500/30 bg-amber-500/10'}`;
    alert.classList.toggle('hidden',!message);
  }
  function scanMessage(kind,title,message,resume=true) {
    root.showScanResult(kind,title,message); el('btnResumeScan').classList.toggle('hidden',!resume); controls();
  }
  function displayIdentity() {
    el('registerScreen').classList.add('hidden'); el('scannerScreen').classList.remove('hidden');
    el('displayName').textContent = current.profile.displayName;
    el('displayUserId').textContent = `MSV: ${current.profile.studentId}`;
    el('displayDepartment').textContent = 'Lớp: ---';
    // Không hiển thị khóa bí mật thiết bị trên giao diện.
    el('displayDeviceId').textContent = 'ID: Đã xác minh';
  }
  async function stopCamera() {
    if (cameraOn && scanner) { cameraOn = false; try { await scanner.stop(); scanner.clear(); } catch (_) {} }
    el('scanOverlay').classList.add('hidden');
  }
  async function capabilities() {
    if (refreshing || !current) return;
    refreshing = true; const version = generation, started = performance.now(), wasReady = ready();
    try {
      const data = await rpc('get_attendance_capabilities'); if (version !== generation) return;
      if (data?.version !== 1 || data.profileId !== current.profile.id) throw Error('Invalid capability response');
      caps = data;
      const remaining = Date.parse(data.window?.endsAt) - Date.parse(data.serverTime);
      deadline = started + (Number.isFinite(remaining) ? Math.max(0,remaining) : 0);
      if (!data.deviceBound && verified) { verified=false; await stopCamera(); registration('Thiết bị đã được mở khóa. Xác nhận để đăng ký lại.'); }
      if (verified) {
        if (!ready()) {
          await stopCamera();
          scanMessage('warning','Chưa nhận điểm danh',!data.qrEnabled ? 'Điểm danh đang tạm dừng để cập nhật.' : !data.window ? 'Hiện ngoài giờ nhận điểm danh.' : data.sessionClosed ? 'Ca điểm danh đã chốt.' : 'Đang chờ quản trị viên mở mã QR.');
        } else if (!wasReady && !stickyResult) scanMessage('warning','Sẵn sàng quét','Bấm Tiếp Tục Quét Lại để mở camera.');
      }
    } catch(error) {
      if (version !== generation) return;
      caps=null; deadline=0; await stopCamera();
      const text=['PGRST202','42501'].includes(error?.code) ? 'Điểm danh đang chờ quản trị viên hoàn tất cập nhật.' : errorText(error);
      if (verified) scanMessage('warning','Chưa nhận điểm danh',text); else registration(text,true);
    } finally { refreshing=false; controls(); }
  }
  async function verifyDevice() {
    const identity=await api.identity();
    if (!identity || identity.profile.id!==current.profile.id) throw {code:'SESSION_CHANGED'};
    if (el('inputUserId').value.trim()!==current.profile.studentId) throw {message:'APP_INVALID_INPUT'};
    const version=generation;
    const result=await rpc('register_my_device',{p_device_token:token()});
    if (version!==generation) throw {code:'SESSION_CHANGED'};
    if (result?.deviceVerified!==true || result.profileId!==current.profile.id) throw Error('Invalid device response');
    verified=true; displayIdentity();
    scanMessage('warning','Thiết bị đã xác minh',pendingToken ? 'Đã nhận liên kết QR. Bấm Tiếp Tục Quét Lại để xác nhận điểm danh.' : 'Bấm Tiếp Tục Quét Lại để mở camera.');
  }
  root.handleRegisterDevice=async event=>{
    event.preventDefault(); if(busy || caps?.qrEnabled!==true) return;
    busy=true; controls();
    try { await verifyDevice(); } catch(error) { verified=false; registration(errorText(error),true); }
    finally { busy=false; await capabilities(); controls(); }
  };
  function parseToken(value) {
    let result=String(value||'').trim();
    if (!/^[a-f0-9]{32}$/.test(result)) {
      try { const url=new URL(result); result=url.searchParams.get('t')||url.searchParams.get('token')||''; } catch(_){result='';}
    }
    if(!/^[a-f0-9]{32}$/.test(result)) throw {message:'APP_INVALID_QR'};
    return result;
  }
  async function submit(value) {
    if (busy || !ready()) return;
    busy=true; controls(); const version=generation;
    await stopCamera(); scanMessage('loading','Đang xử lý','Đang xác nhận điểm danh với hệ thống.',false);
    try {
      const qr=parseToken(value),identity=await api.identity();
      if (!identity || identity.profile.id!==current.profile.id || version!==generation) throw {code:'SESSION_CHANGED'};
      const result=await rpc('submit_attendance',{p_qr_token:qr,p_device_fingerprint:token()});
      if (version!==generation) return;
      const data=result?.data;
      if(result?.success!==true || data?.profileId!==current.profile.id || !data.id || !data.scannedAt || !['Có mặt','Đi trễ'].includes(data.status)) throw Error('Invalid attendance response');
      stickyResult=true;
      scanMessage(true,result.testMode ? (result.alreadyScanned?'THỬ: Đã ghi nhận trước đó':'THỬ: Quét QR thành công') : (result.alreadyScanned?'Đã ghi nhận trước đó':'Điểm danh thành công'),`Ca ${data.shift} · ${data.status} · ${current.profile.displayName}`);
      root.playBeep?.(true);
    }catch(error) {
      if (version!==generation) return;
      stickyResult=true; scanMessage(false,'Chưa điểm danh được',errorText(error)); root.playBeep?.(false);
    }finally { busy=false; controls(); }
  }
  root.onScanSuccess=value=>submit(value);
  root.resumeScanner=async()=>{
    if(busy || cameraStarting || !verified) return;
    await capabilities(); if(!ready()) return;
    stickyResult=false;
    if(pendingToken){const value=pendingToken;pendingToken=null;await submit(value);return;}
    const version=generation; cameraStarting=true; controls();
    try {
      scanner ||= new root.Html5Qrcode('reader');
      await scanner.start({facingMode:'environment'},{fps:10,qrbox:{width:250,height:250}},text=>{if(cameraOn&&!busy)void submit(text);},()=>{});
      cameraOn=true;
      if(version!==generation || document.hidden || !ready()){await stopCamera();return;}
      el('scanAlert').classList.add('hidden'); el('btnResumeScan').classList.add('hidden'); el('scanOverlay').classList.remove('hidden');
    }catch(_) {scanMessage(false,'Không mở được camera','Kiểm tra quyền camera của trình duyệt rồi bấm Tiếp Tục Quét Lại.');}
    finally {cameraStarting=false;controls();}
  };
  root.handleSwitchAccount=async()=>{
    const choice=root.prompt('Chọn thao tác:\n1 - Đổi mật khẩu\n2 - Đăng xuất / Đổi tài khoản\nBấm Hủy để giữ nguyên.','1');
    if(choice===null || !String(choice).trim())return;
    if(String(choice).trim()==='1'){
      generation++;caps=null;deadline=0;controls();await stopCamera();
      root.location.assign('reset-password.html');return;
    }
    if(String(choice).trim()!=='2')return;
    generation++; verified=false; caps=null; deadline=0; controls();await stopCamera();
    try { const result=await api.client.auth.signOut({scope:'local'});if(result.error)throw result.error;root.location.replace('index.html'); }
    catch(error){registration(errorText(error),true);}
  };
  api.client.auth.onAuthStateChange((event,session)=>{
    if(event==='SIGNED_OUT'){generation++;verified=false;caps=null;deadline=0;void stopCamera();root.location.replace('index.html');}
    if(event==='SIGNED_IN' && current && session?.user?.id && session.user.id!==current.profile.id){generation++;verified=false;caps=null;deadline=0;void stopCamera();setTimeout(()=>void init(),0);}
  });
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden){generation++;caps=null;deadline=0;void stopCamera();controls();}
    else void capabilities();
  });
  setInterval(()=>{if(!document.hidden)void capabilities();},10000);
  setInterval(()=>{if(cameraOn&&!ready()){void stopCamera();scanMessage('warning','Đã hết giờ','Ca đã hết giờ nhận điểm danh.');}},1000);
  async function init() {
    registration('Đang kiểm tra tài khoản…');controls();el('scanOverlay').classList.add('hidden');
    try {
      current=await api.requireIdentity();if(!current)return;
      el('inputUserId').value=current.profile.studentId;el('inputUserId').readOnly=true;
      const params=new URLSearchParams(root.location.search);pendingToken=params.get('t')||params.get('token')||pendingToken;
      if(params.has('t')||params.has('token'))root.history.replaceState(null,'',root.location.pathname);
      await capabilities();
      if(caps?.qrEnabled&&caps.deviceBound) {try{await verifyDevice();}catch(error){registration(errorText(error),true);}}
      else if(caps?.qrEnabled)registration('Xác nhận để gắn trình duyệt này với tài khoản đang đăng nhập.');
      await capabilities();
    }catch(error){registration(errorText(error),true);}
    controls();
  }
  void init();
})(globalThis);
