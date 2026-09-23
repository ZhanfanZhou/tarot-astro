/**
 * 旧入口恢复脚本 —— 把卡在旧缓存里的页面送回新版。
 *
 * nginx 在「请求的 /assets/index-<hash>.js 不存在」时发这个文件，规则见
 * deploy/nginx/frontend.conf：Content-Type 必须是 application/javascript，
 * Cache-Control: no-store，并关掉 ETag 与 If-Modified-Since。
 *
 * 为什么需要它：浏览器缓存里的旧 index.html 写死了旧入口的文件名，而那个文件
 * 已经被新构建换掉。旧 HTML 只要还在缓存新鲜期内就不会向服务器要新版，于是永远
 * 加载不到应用 —— 服务器改什么都送不到它手里。唯一的破局点是旧 HTML 仍会去请求
 * 那个旧入口 URL，这里就是那次请求的落点。
 *
 * 它做的唯一一件事：给当前地址加一个版本参数再整页跳转。query 变了缓存键就变了，
 * 浏览器必然回源，拿到的就是新版 index.html。
 *
 * 它不恢复数据，也不碰 localStorage、cookie、登录态。只对历史主入口生效 ——
 * 其余缺失资源一律 404，不要拿它冒充别的模块。
 */
(() => {
  'use strict';

  const RELEASE = '20260923-cache-recovery-v1';
  const PARAM = '__xiaox_recovery';
  const GUARD = '__xiaox_legacy_recovery_started';

  // 同一个文档里只跑一次（旧 HTML 可能引用同一个入口两次）。
  if (window[GUARD]) return;
  window[GUARD] = true;

  const url = new URL(window.location.href);
  // 两道防循环：文档级标记管本次加载，URL 参数管跳转链。
  // 故意不写 sessionStorage —— 持久化的「已重试」标记会拦住以后对同一地址的正常访问。
  const attempted = url.searchParams.get(PARAM) === RELEASE;

  function showFailure() {
    const panel = document.createElement('div');
    panel.style.cssText =
      'padding:32px;max-width:560px;margin:12vh auto;font-family:system-ui;' +
      'color:#ede6d6;background:#161522;line-height:1.7';

    const title = document.createElement('h1');
    title.textContent = '页面暂时未能更新';

    const text = document.createElement('p');
    text.textContent = '请稍后重新加载。你的登录信息和已保存内容不会被清除。';

    const retry = new URL(window.location.href);
    retry.searchParams.set(PARAM, RELEASE);
    retry.searchParams.set('__xiaox_retry', String(Date.now()));

    const link = document.createElement('a');
    link.href = retry.href;
    link.textContent = '重新加载';
    link.style.color = '#dfc58c';

    panel.append(title, text, link);
    document.body.replaceChildren(panel);
    document.title = '页面暂时未能更新';
  }

  // 带着恢复参数还落到这里，说明跳过去拿到的仍是旧 HTML。不再自动跳，改出可见提示。
  if (attempted) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', showFailure, { once: true });
    } else {
      showFailure();
    }
    return;
  }

  url.searchParams.set(PARAM, RELEASE);
  window.location.replace(url.href);
})();
