"""開發用：量一下台北市/新北市公車 StopOfRoute 全量有多大，決定後續怎麼篩選。"""

import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from tdx_client import get_json  # noqa: E402

for city in ["Taipei", "NewTaipei"]:
    data = get_json(f"/v2/Bus/StopOfRoute/City/{city}", max_retries=8)
    print(f"{city}: {len(data)} 筆 subroute+direction")
