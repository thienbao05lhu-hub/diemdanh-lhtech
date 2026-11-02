/* Logic cho nút cũ. Không tạo UI; pending không có nghĩa đã gửi. */
(function(root){
 'use strict';
 function create({fetchImpl,pause=ms=>new Promise(r=>setTimeout(r,ms))}){
  return async function send(shift,onStatus=()=>{}){
   async function read(url,options){
    const res=await fetchImpl(url,options),body=await res.json();
    if(!res.ok || !body.success)throw new Error(body.message||'Không kiểm tra được yêu cầu Zalo.');
    const d=body.data;
    if(!d || !/^[0-9a-f-]{36}$/i.test(d.id)||!['pending','sending','sent','failed','unknown','cancelled'].includes(d.status)
      ||d.sent!==(d.status==='sent'))throw new Error('Phản hồi Zalo chưa hợp lệ.');
    return d;
   }
   let job=await read('/api/attendance/force-zalo-report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({shift})});
   const id=job.id;
   for(let attempt=0;attempt<24;attempt++){
    onStatus(job.status);
    if(!['pending','sending'].includes(job.status))return job;
    await pause(5000);
    job=await read(`/api/attendance/zalo-delivery?id=${encodeURIComponent(id)}`);
    if(job.id!==id)throw new Error('Trạng thái không khớp yêu cầu Zalo.');
   }
   onStatus(job.status);return job;
  };
 }
 root.ZaloDelivery=Object.freeze({create,send:(shift,callback)=>create({fetchImpl:(...args)=>root.fetch(...args)})(shift,callback)});
})(globalThis);
