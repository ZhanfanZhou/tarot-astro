#!/usr/bin/env bash
#
# publish-frontend.sh —— 在服务器上构建并原子发布前端
#
# 在服务器（Ubuntu）上跑，不是本地脚本。用了 GNU mv 的 -T。
#
# 为什么不再直接 npm run build 就算发布完：
#   vite build 会先清空输出目录再写产物，而 nginx 一直在读同一个目录。清空到写完
#   之间线上是半套产物。更要命的是每次构建都换内容哈希、旧文件当场消失，浏览器里
#   还留着旧 index.html 的用户立刻失去依赖 —— 2026-09-23 的白屏事故就是这条。
#
# 这个脚本把「构建」和「对外服务」分成两个目录：
#   1. 照常 npm run build，产物落在 dist/（nginx 不再读这里）
#   2. 校验 index.html 引用的资源都在、都不为空；缺一个就中止，线上不受影响
#   3. 复制到 releases/<build-id>/，只要 index.html + assets/
#      （牌图 259MB 由 nginx 从 public/tarot-images/ 直发，不进 release）
#   4. rename 原子切换 published 符号链接 —— nginx 的 root 指向它
#   5. 只留最近两版 release，更旧的删掉
#
# 刻意不保留旧版本的 assets 对外服务：产品要求所有人打开就是最新页面。
# 浏览器请求已经消失的旧入口时，由 nginx 的恢复脚本规则把它送去新版，
# 见 deploy/nginx/frontend.conf。releases/ 里留的上一版只供人工回滚。
#
# 用法（服务器上，仓库根目录）：
#   ./deploy/publish-frontend.sh              # 构建并发布
#   ./deploy/publish-frontend.sh --rollback   # 切回上一版，不构建
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FRONTEND="$ROOT/frontend"
DIST="$FRONTEND/dist"
RELEASES="$FRONTEND/releases"
PUBLISHED="$FRONTEND/published"
KEEP=2

# ===== 原子切换 =====
# ln -sfn 自己不是原子的（先 unlink 再 symlink），所以先建临时链接，
# 再用 mv -T 的 rename(2) 一步换上去。-T 不能省：published 是指向目录的符号链接，
# 不加 -T 的 mv 会把链接塞进目录里，而不是替换它。
swap_to() {
  local target="$1"
  ln -sfn "$target" "$PUBLISHED.tmp"
  mv -Tf "$PUBLISHED.tmp" "$PUBLISHED"
  echo ">>> published -> $(basename "$target")"
}

# ===== --rollback：切回上一版 =====
if [[ "${1:-}" == "--rollback" ]]; then
  mapfile -t rels < <(find "$RELEASES" -mindepth 1 -maxdepth 1 -type d | sort)
  if (( ${#rels[@]} < 2 )); then
    echo "错误：releases/ 里不足两版，没有可回滚的目标" >&2
    exit 1
  fi
  swap_to "${rels[-2]}"
  echo ">>> 回滚完成。nginx 不用 reload，root 跟着符号链接走。"
  exit 0
fi

# ===== 构建 =====
echo ">>> 构建：$FRONTEND"
cd "$FRONTEND"
npm run build

# ===== 校验产物 =====
# 构建失败时 set -e 已经在上一步中止了，这里查的是「构建声称成功但产物不完整」：
# 内存只有 1GB 且无 swap，vite 被 OOM kill 是真实存在的情况。
[[ -f "$DIST/index.html" ]] || { echo "错误：$DIST/index.html 不存在" >&2; exit 1; }

missing=0
while read -r ref; do
  [[ -n "$ref" ]] || continue
  if [[ ! -s "$DIST/$ref" ]]; then
    echo "错误：index.html 引用的 $ref 不在产物里或是空文件" >&2
    missing=1
  fi
done < <(grep -oE '(src|href)="/[^"]+"' "$DIST/index.html" | sed -E 's/.*="\/([^"]+)"/\1/')
(( missing == 0 )) || { echo "错误：产物不完整，已中止，线上仍是上一版" >&2; exit 1; }
echo ">>> 产物校验通过"

# ===== 复制到新 release =====
BUILD_ID="$(date -u +%Y%m%d-%H%M%S)"
REL="$RELEASES/$BUILD_ID"
mkdir -p "$REL"
cp -a "$DIST/index.html" "$REL/"
cp -a "$DIST/assets" "$REL/"
echo ">>> release: $REL（$(du -sh "$REL" | cut -f1)）"

# ===== 原子切换 =====
swap_to "$REL"

# ===== 清理旧 release =====
# 绝不删当前 published 指向的那个目录（回滚之后当前版可能不是最新的那个）。
current="$(readlink -f "$PUBLISHED")"
mapfile -t rels < <(find "$RELEASES" -mindepth 1 -maxdepth 1 -type d | sort)
if (( ${#rels[@]} > KEEP )); then
  for old in "${rels[@]:0:${#rels[@]}-KEEP}"; do
    [[ "$(readlink -f "$old")" == "$current" ]] && continue
    rm -rf "$old"
    echo ">>> 删除旧 release: $(basename "$old")"
  done
fi

echo ">>> 完成。nginx 不用 reload —— root 指向 published 符号链接，下一个请求就生效。"
