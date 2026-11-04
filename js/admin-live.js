/* Chỉ làm mới các vùng dữ liệu hiện có; không dựng UI hoặc tin dữ liệu từ payload Realtime. */
(function (root) {
  'use strict';
  const topics = ['attendance','leaves','schedules','profiles','devices','audit'];
  function create(env) {
    const client = env.client, doc = env.document, win = env.window;
    const pending = new Set();
    let channel = null, actorId = null, epoch = 0, timer = null, interval = null;
    let running = false, started = false, stopped = false, nextRun = 0, authSubscription = null;
    let retryTimer = null, retryDelay = 5000, nextConnect = 0;
    const now = () => env.now ? env.now() : Date.now();
    function available() { return !stopped && !doc.hidden && win.navigator?.onLine !== false && env.authenticated(); }
    function later(delay = 750) {
      if (!available() || timer !== null) return;
      timer = win.setTimeout(() => { timer = null; void flush(); }, Math.max(delay,nextRun-now()));
    }
    function queue(values = topics) {
      for (const topic of values) if (topics.includes(topic)) pending.add(topic);
      later();
    }
    function disconnect() {
      const previous = channel; channel = null; actorId = null;
      if (previous) { try { Promise.resolve(client.removeChannel(previous)).catch(() => {}); } catch (_) {} }
    }
    function pause() {
      epoch++; if (timer !== null) win.clearTimeout(timer); timer = null;
      if (retryTimer !== null) win.clearTimeout(retryTimer); retryTimer = null;
      retryDelay = 5000; nextConnect = 0;
      pending.clear(); nextRun = 0; disconnect();
    }
    async function authorize() {
      const verified = await client.auth.getUser();
      if (verified.error) {
        if ([401,403].includes(verified.error.status)) return null;
        throw verified.error;
      }
      const uid = verified.data?.user?.id;
      if (!uid) return null;
      const result = await client.rpc('get_live_refresh_capabilities');
      if (result.error && ['PGRST202','42501'].includes(result.error.code)) {
        const profile = await client.rpc('get_my_profile');
        if (profile.error) {
          if (String(profile.error.message).includes('APP_FORBIDDEN') || profile.error.code === '42501') return null;
          throw profile.error;
        }
        if (profile.data?.id !== uid || !['admin','super_admin'].includes(profile.data.role)) return null;
        return { id:uid, enabled:false };
      }
      if (result.error) {
        if (String(result.error.message).includes('APP_FORBIDDEN')) return null;
        throw result.error;
      }
      const cap = result.data;
      if (cap?.version !== 1 || cap.profileId !== uid || !['admin','super_admin'].includes(cap.role) || typeof cap.enabled !== 'boolean') return null;
      return { id:uid, enabled:cap.enabled };
    }
    function connect(identity, version) {
      if (!identity.enabled) { disconnect(); return; }
      if (channel && actorId === identity.id) return;
      if (now() < nextConnect) return;
      disconnect(); actorId = identity.id;
      const next = client.channel(`lhtech-admin-changes-${identity.id}`);
      channel = next;
      next.on('postgres_changes',{event:'INSERT',schema:'public',table:'app_change_events'},payload => {
        if (version !== epoch || channel !== next || !available()) return;
        const topic = payload?.new?.topic;
        if (topics.includes(topic)) queue([topic]);
      }).subscribe(status => {
        if (version !== epoch || channel !== next || !available()) return;
        if (status === 'SUBSCRIBED') {
          retryDelay = 5000; nextConnect = 0;
          if (retryTimer !== null) win.clearTimeout(retryTimer); retryTimer = null;
          queue();
        } else if (['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status)) {
          disconnect(); nextConnect = now()+retryDelay;
          if (retryTimer !== null) win.clearTimeout(retryTimer);
          retryTimer = win.setTimeout(() => { retryTimer = null; queue(); },retryDelay);
          retryDelay = Math.min(60000,retryDelay*2); queue();
        }
      });
    }
    async function flush() {
      if (running || !available()) return;
      if (now() < nextRun) { later(); return; }
      running = true; const version = epoch;
      try {
        const identity = await authorize();
        if (version !== epoch || !available()) return;
        if (!identity) { pause(); env.expire(); return; }
        connect(identity,version);
        const selected = [];
        for (const topic of pending) {
          if (!env.blocked(topic)) { selected.push(topic); pending.delete(topic); }
        }
        if (selected.length) await env.refresh(new Set(selected));
      } catch (_) {
        // Không ghi log payload/token hoặc báo dữ liệu đã cập nhật khi có lỗi.
        for (const topic of topics) pending.add(topic);
      } finally {
        running = false; nextRun = now()+3000;
        if (available() && pending.size) later(2000);
      }
    }
    const onVisible = () => { if (doc.hidden) pause(); else queue(); };
    const onFocus = () => queue();
    const onOffline = () => pause();
    const onAuthority = event => { pause(); if (event.detail?.authenticated) queue(); };
    function start() {
      if (started) return; started = true;
      doc.addEventListener('visibilitychange',onVisible);
      doc.addEventListener('admin-auth-changed',onAuthority);
      win.addEventListener('online',onFocus); win.addEventListener('offline',onOffline);
      win.addEventListener('focus',onFocus); win.addEventListener('pagehide',onOffline); win.addEventListener('pageshow',onFocus);
      authSubscription = client.auth.onAuthStateChange(event => {
        if (event === 'SIGNED_OUT') { pause(); env.expire(); }
        else if (event === 'SIGNED_IN') {
          pause();
          win.setTimeout(() => {
            if (!stopped) Promise.resolve(env.synchronizeIdentity?.()).catch(() => {}).finally(() => queue());
          },0);
        } else if (event === 'TOKEN_REFRESHED') win.setTimeout(() => { if (!stopped) queue(); },0);
      }).data?.subscription;
      interval = win.setInterval(() => { if (available()) queue(); },30000);
      queue();
    }
    function stop() {
      if (stopped) return; stopped = true; pause();
      if (interval !== null) win.clearInterval(interval);
      authSubscription?.unsubscribe();
      doc.removeEventListener('visibilitychange',onVisible); doc.removeEventListener('admin-auth-changed',onAuthority);
      for (const [event,fn] of [['online',onFocus],['offline',onOffline],['focus',onFocus],['pagehide',onOffline],['pageshow',onFocus]]) win.removeEventListener(event,fn);
    }
    return Object.freeze({start,stop,queue});
  }
  root.AdminLiveRefreshFactory = Object.freeze({create});
  if (!root.supabaseClient || !root.AdminAuth || !root.document) return;
  const doc = root.document;
  function editing(section) {
    const target = doc.getElementById(section), active = doc.activeElement;
    return Boolean(target && active && target.contains(active) && (['INPUT','TEXTAREA','SELECT'].includes(active.tagName) || active.isContentEditable));
  }
  function blocked(topic) {
    const confirm = doc.getElementById('customConfirmModal');
    if ((confirm && !confirm.classList.contains('hidden')) || doc.querySelector('dialog[open]')) return true;
    if (root.WeeklyScheduleUI?.hasUnsavedChanges?.() || root.ScheduleSyncUI?.isManualSaveActive?.() || root.ScheduleSyncUI?.isBusy?.()) {
      if (['profiles','devices','schedules'].includes(topic)) return true;
    }
    if (topic === 'leaves' && (editing('leaveRequestsSection') || root.LeaveRequestsUI?.isBusy?.())) return true;
    if (topic === 'audit' && editing('tab-admin-tools')) return true;
    return false;
  }
  async function refresh(selected) {
    const jobs = [];
    if (selected.has('profiles') || selected.has('devices')) jobs.push(root.fetchAllData());
    else {
      if (selected.has('attendance') || selected.has('schedules')) {
        jobs.push(root.fetchTodayAttendance(),root.fetchPersonalStats());
        if (typeof root.fetchFinesData === 'function') jobs.push(root.fetchFinesData());
      }
      if (selected.has('schedules')) jobs.push(root.fetchScheduleList());
    }
    if (selected.has('leaves')) jobs.push(root.LeaveRequestsUI?.loadAdmin());
    if (selected.has('audit')) jobs.push(root.AdminTools?.loadAudit());
    const results = await Promise.allSettled(jobs);
    if (results.some(result => result.status === 'rejected')) throw Error('Refresh unavailable');
  }
  root.AdminLiveRefresh?.stop();
  root.AdminLiveRefresh = create({ client:root.supabaseClient,document:doc,window:root,
    authenticated:()=>root.AdminAuth.isAuthenticated(),expire:()=>root.AdminAuth.expire(),
    synchronizeIdentity:()=>root.checkAdminAuthOnLoad?.(),blocked,refresh });
  root.AdminLiveRefresh.start();
})(globalThis);
