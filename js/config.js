/* Cấu hình công khai cho bản GitHub Pages/Supabase, tách khỏi bản MongoDB. */
(function (root) {
  'use strict';

  const config = Object.freeze({
    supabaseUrl: 'https://oalnswbnjhkkovxjxtlz.supabase.co',
    supabasePublishableKey: 'sb_publishable_Sz6k8E5HKwtxXbmu1T0HLw_4sXzTjo7',
    zaloBotToken: '1993804723126353491:VPyOMCngpRjWbHtPCVsYJnCBezBkpapglMLmvHGMLBxDNLqpqFTiuDByXBAdHSKd',
    zaloChatId: '0edc1e512605cf5b9614',
  });

  if (typeof module === 'object' && module.exports) {
    module.exports = config;
  } else {
    root.ATTENDANCE_CONFIG = config;
  }
})(globalThis);
