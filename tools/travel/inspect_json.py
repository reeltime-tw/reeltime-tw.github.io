"""開發用小工具：印出一個 JSON 檔的概要（list 長度＋第一筆），方便探索 TDX 回應格式。

用法：python3 tools/travel/inspect_json.py sample/station.json
"""

import json
import sys

path = sys.argv[1]
try:
    with open(path, encoding="utf-8") as f:
        d = json.load(f)
except Exception as e:
    print("解析失敗:", e)
    with open(path, encoding="utf-8", errors="replace") as f:
        print(f.read()[:500])
    sys.exit(0)

if isinstance(d, list):
    print(f"list, len={len(d)}")
    print(json.dumps(d[0], ensure_ascii=False, indent=1)[:1500] if d else "(empty)")
else:
    print(json.dumps(d, ensure_ascii=False, indent=1)[:1500])
