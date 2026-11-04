/* Định tuyến RPC bằng trạng thái thử từ server, không đổi UI hoặc quyền Auth. */
(function(root){
  'use strict';
  const clients=new WeakMap();
  const routes=Object.freeze({get_attendance_capabilities:'qr_test_get_capabilities',admin_get_active_qr:'qr_test_admin_get_qr',
    admin_refresh_active_qr:'qr_test_admin_refresh_qr',
    submit_attendance:'qr_test_submit',admin_get_shift_attendance:'qr_test_admin_get_shift',get_my_attendance:'qr_test_get_mine',
    admin_close_attendance_session:'qr_test_admin_close',get_admin_attendance_capabilities:'qr_test_admin_edit_capabilities'});
  const blocked=new Set(['student_create_leave_request','admin_decide_leave_request','admin_delete_leave_request','admin_adjust_attendance']);
  const failure=error=>({data:null,error,status:error?.code==='APP_FORBIDDEN'?403:503});
  async function mode(client){
    const raw=clients.get(client);if(!raw)return {data:{testMode:false},error:null};
    try{
      const result=await raw('get_qr_test_mode');
      if(result.error&&['PGRST202','42501'].includes(result.error.code))return {data:{testMode:false},error:null};
      if(result.error)return result;
      if(result.data?.version!==1||typeof result.data.testMode!=='boolean'||!result.data.profileId)
        return failure({code:'APP_STATE_NOT_READY',message:'Chưa xác minh được chế độ điểm danh.'});
      return result;
    }catch(_){return failure({code:'NETWORK_ERROR',message:'Chưa xác minh được chế độ điểm danh.'});}
  }
  function install(client){
    if(clients.has(client))return;
    const raw=client.rpc.bind(client);clients.set(client,raw);
    client.rpc=async(name,args,options)=>{
      if(!Object.hasOwn(routes,name)&&!blocked.has(name))return raw(name,args,options);
      const result=await mode(client);if(result.error)return result;
      if(result.data.testMode&&blocked.has(name))return failure({code:'APP_TEST_QR_ONLY',message:'APP_TEST_QR_ONLY'});
      return raw(result.data.testMode?routes[name]:name,args,options);
    };
  }
  root.AttendanceTrialRouter=Object.freeze({install,mode});
})(globalThis);
