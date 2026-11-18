"""列出全部「有座標又有場次資料」的影城，給 build_all.py 當目標清單。
印到 stdout 的 JSON：[{"id": "...", "lat": .., "lon": ..}, ...]（依 id 排序）。

用法：python3 make_targets.py [docs 資料夾路徑，預設 ../../docs]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path


def main():
    docs_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent.parent.parent / "docs"
    geo = json.loads((docs_dir / "cinema-geo.json").read_text(encoding="utf-8"))["cinemas"]
    data_ids = {c["id"] for c in json.loads((docs_dir / "data.json").read_text(encoding="utf-8"))["cinemas"]}
    targets = [
        {"id": cid, "lat": latlon[0], "lon": latlon[1]}
        for cid, latlon in geo.items()
        if cid in data_ids
    ]
    targets.sort(key=lambda t: t["id"])
    print(json.dumps(targets, ensure_ascii=False))


if __name__ == "__main__":
    main()
