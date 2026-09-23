import { describe, it, expect, beforeEach, vi } from 'vitest';
// @ts-expect-error ?raw 是 Vite 的原文导入，只在测试里用
import SOURCE from '../../recovery/legacy-entry-recovery.js?raw';

// recovery/legacy-entry-recovery.js 不进构建产物 —— nginx 在旧入口文件缺失时
// 直接把它发给浏览器（见 deploy/nginx/frontend.conf）。正因为它不被任何
// import 引用，没有这份测试就没人保护它。这里按浏览器的方式执行它：整段源码丢进
// jsdom 的 window 里跑。

const RELEASE = '20260923-cache-recovery-v1';
const GUARD = '__xiaox_legacy_recovery_started';

function runAt(href: string) {
  const replace = vi.fn();
  Object.defineProperty(window, 'location', {
    value: { href, replace },
    writable: true,
    configurable: true,
  });
  new Function(SOURCE)();
  return replace;
}

beforeEach(() => {
  delete (window as unknown as Record<string, unknown>)[GUARD];
  document.body.innerHTML = '';
  document.title = '';
});

describe('旧入口恢复脚本', () => {
  it('第一次执行：带版本参数整页跳转，逼浏览器回源取新 HTML', () => {
    const replace = runAt('https://xiaox.art/admin');
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace.mock.calls[0][0]).toBe(`https://xiaox.art/admin?__xiaox_recovery=${RELEASE}`);
  });

  it('保留原有的查询参数和 fragment，只加自己那一个', () => {
    const replace = runAt('https://xiaox.art/?from=weibo#reading');
    const next = new URL(replace.mock.calls[0][0]);
    expect(next.searchParams.get('from')).toBe('weibo');
    expect(next.searchParams.get('__xiaox_recovery')).toBe(RELEASE);
    expect(next.hash).toBe('#reading');
  });

  it('同一个文档里重复执行只跳一次', () => {
    const replace = runAt('https://xiaox.art/admin');
    new Function(SOURCE)();
    new Function(SOURCE)();
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it('跳过一次还落回这里：不再跳转，改出可见提示', () => {
    const replace = runAt(`https://xiaox.art/admin?__xiaox_recovery=${RELEASE}`);
    expect(replace).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('页面暂时未能更新');
    expect(document.title).toBe('页面暂时未能更新');
  });

  it('提示里的重试链接仍指向同一地址，不清除任何登录数据', () => {
    runAt(`https://xiaox.art/admin?__xiaox_recovery=${RELEASE}`);
    const link = document.querySelector('a');
    expect(link).not.toBeNull();
    const retry = new URL(link!.href);
    expect(retry.pathname).toBe('/admin');
    expect(retry.searchParams.get('__xiaox_retry')).toMatch(/^\d+$/);
    // 不碰 storage / cookie，也不用 Clear-Site-Data。只看代码，注释里提到这些词是允许的。
    const code = (SOURCE as string)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/localStorage|sessionStorage|document\.cookie|Clear-Site-Data/);
  });

  it('上一个版本的参数不算数，会重新跳一次', () => {
    const replace = runAt('https://xiaox.art/admin?__xiaox_recovery=20250101-old');
    expect(replace).toHaveBeenCalledTimes(1);
    expect(new URL(replace.mock.calls[0][0]).searchParams.get('__xiaox_recovery')).toBe(RELEASE);
  });
});
