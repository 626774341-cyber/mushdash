#!/usr/bin/env bash
# ============================================================
# MushDash 一键发布脚本
# 用法: ./tools/release.sh <版本号> <版本名>
#   例: ./tools/release.sh 2.1.0 "霓虹夜狂想"
#
# 前置（手工完成）:
#   1. 在 CHANGELOG.md 顶部写好新版本的小节（## vX.Y.Z · 日期 · 名称 + 更新要点）
#   2. 需要时同步 js/game.js 里 VERSIONS 列表的游戏内记录
#
# 脚本会自动: 写入版本号 → 归档 versions/vX.Y/ 快照 → 提交推送 →
#             打标签 → 用 CHANGELOG 顶部小节创建 GitHub Release
# ============================================================
set -euo pipefail
VER="${1:?用法: ./tools/release.sh <版本号> <版本名>}"
NAME="${2:?缺少版本名}"
cd "$(dirname "$0")/.."

# 1) 版本号写入 game.js 与 index.html 兜底文本
python3 - "$VER" <<'EOF'
import io, re, sys
ver = sys.argv[1]
p = "js/game.js"
s = io.open(p, encoding="utf-8").read()
s = re.sub(r"const GAME_VERSION = '[^']+';", f"const GAME_VERSION = '{ver}';", s)
io.open(p, "w", encoding="utf-8").write(s)
p = "index.html"
s = io.open(p, encoding="utf-8").read()
s = re.sub(r"v\d+\.\d+\.\d+ · 更新记录", f"v{ver} · 更新记录", s)
io.open(p, "w", encoding="utf-8").write(s)
print("✔ 版本号已写入", ver)
EOF

# 2) 快照归档（独立可玩副本）
mkdir -p "versions/v$VER"
cp index.html "versions/v$VER/"
cp -r css "versions/v$VER/"
cp -r js "versions/v$VER/"
cp LICENSE "versions/v$VER/" 2>/dev/null || true

# 3) 提交 + 标签 + 推送
git add -A
git commit -m "v$VER $NAME：发布并归档快照" || echo "（无新改动可提交）"
git tag -f "v$VER" -m "V$VER $NAME"
git push origin main
git push origin "v$VER"

# 4) GitHub Release（读取 CHANGELOG.md 顶部小节作为发布说明）
NOTES=$(python3 - <<'EOF'
import io, re
s = io.open("CHANGELOG.md", encoding="utf-8").read()
m = re.search(r"## v[^#]+?(?=\n## v|\Z)", s, re.S)
print(m.group(0).strip() if m else "")
EOF
)
python3 - "$VER" "$NAME" "$NOTES" <<'EOF'
import json, os, sys, urllib.request
ver, name, notes = sys.argv[1], sys.argv[2], sys.argv[3]
cred = os.popen("printf 'protocol=https\\nhost=github.com\\n' | git credential fill").read()
tok = next((l[9:].strip() for l in cred.splitlines() if l.startswith("password=")), "")
usr = next((l[9:].strip() for l in cred.splitlines() if l.startswith("username=")), "")
payload = json.dumps({
    "tag_name": f"v{ver}", "name": f"V{ver} {name}", "body": notes,
    "draft": False, "prerelease": False,
}).encode("utf-8")
req = urllib.request.Request(
    "https://api.github.com/repos/626774341-cyber/mushdash/releases",
    data=payload, method="POST",
    headers={"Authorization": f"token {tok}", "Accept": "application/vnd.github+json",
             "Content-Type": "application/json", "User-Agent": "mushdash-release"})
with urllib.request.urlopen(req) as r:
    res = json.load(r)
    print("✔ GitHub Release 创建成功:", res.get("html_url"))
EOF

echo "✅ v$VER「$NAME」发布完成"
echo "   线上游玩: https://626774341-cyber.github.io/mushdash/"
echo "   历史快照: https://626774341-cyber.github.io/mushdash/versions/v$VER/"
