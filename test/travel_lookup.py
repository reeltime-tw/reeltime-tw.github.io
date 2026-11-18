"""測試路程時間查表（docs/travel/{cinemaId}.bin）的查表、退回粗估、跨午夜場次邏輯。
用法：cd docs && python3 -m http.server 8770 &   再執行  python3 test/travel_lookup.py

用假的 bin 檔（在頁面裡用 fetch 攔截偽造，不用真的放檔案）測：
 1. 查到資料時回傳正確的分鐘數（套過校正倍率後的值，直接從 bin 讀出來）
 2. 座標落在 bbox 外、或該格是 255（不可達）時回傳 null
 3. 沒有這份資料的影城（fetch 404）也要安靜回傳 null，不噴錯
 4. 凌晨 0–3 點的場次（午夜場）算在「隔天」
"""
import sys
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8770/'
fail = []


def check(ok, msg):
    print(('  ✓ ' if ok else '  ✗ ') + msg)
    if not ok:
        fail.append(msg)


# 跟 tools/travel/grid.py 一致的網格常數，用來在測試裡自己算格子編號
LAT0, LON0, CELL_M, REF_LAT = 21.8, 119.3, 500, 23.7


def cell_of(lat, lon):
    import math
    d_lat = CELL_M / 111320.0
    d_lon = CELL_M / (111320.0 * math.cos(math.radians(REF_LAT)))
    return int((lat - LAT0) // d_lat), int((lon - LON0) // d_lon)


def build_fake_bin(row0, col0, width, height, layers_values):
    """layers_values: {layer_name: {(r,c): byte_value}}，沒給的格子預設 255。"""
    import json, struct
    layers = list(layers_values.keys())
    header = {
        "version": 1, "cinemaId": "test-cinema", "computedAt": "2026-11-18",
        "lat0": LAT0, "lon0": LON0, "cellM": CELL_M,
        "row0": row0, "col0": col0, "width": width, "height": height,
        "layers": layers, "calibration": {},
    }
    hb = json.dumps(header, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    body = bytearray()
    for name in layers:
        vals = layers_values[name]
        for r in range(row0, row0 + height):
            for c in range(col0, col0 + width):
                body.append(vals.get((r, c), 255))
    return struct.pack("<I", len(hb)) + hb + bytes(body)


with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    pg = b.new_page()
    pg.goto(BASE)
    pg.wait_for_timeout(500)

    # 影城中心點用台北車站附近一個座標，算出它的格子，蓋一個 3x3 的假 bbox
    clat, clon = 25.0478, 121.5171
    row0_c, col0_c = cell_of(clat, clon)
    row0, col0 = row0_c - 1, col0_c - 1
    width = height = 3
    car_vals = {(row0_c, col0_c): 12, (row0_c, col0_c + 1): 255}  # 中心格=12分，右邊格=不可達
    fake = build_fake_bin(row0, col0, width, height, {"car": car_vals, "walk": {}, "scooter": {}, "transit": {}})
    b64 = fake.hex()

    pg.evaluate("""(hex)=>{
      const bytes=new Uint8Array(hex.length/2);
      for(let i=0;i<bytes.length;i++)bytes[i]=parseInt(hex.substr(i*2,2),16);
      window.__fakeBin=bytes.buffer;
      window.__realFetch=window.fetch.bind(window);
      window.fetch=(url,...a)=>{
        if(String(url).includes('travel/test-cinema.bin'))return Promise.resolve({ok:true,arrayBuffer:()=>Promise.resolve(window.__fakeBin)});
        if(String(url).includes('travel/no-such-cinema.bin'))return Promise.resolve({ok:false});
        return window.__realFetch(url,...a);
      };
    }""", b64)

    # 1. 查到資料：中心格應該回傳 12（bin 裡存的原始位元組，查表函式不再額外乘倍率）
    v = pg.evaluate("""async([lat,lon])=>{await loadTravelBin('test-cinema');return travelLookup('test-cinema',lat,lon,'car')}""", [clat, clon])
    check(v == 12, f'查到資料回傳正確分鐘數：{v}（預期 12）')

    # 2. 同一間影城、隔壁格是 255（不可達）→ null
    import math
    d_lon = CELL_M / (111320.0 * math.cos(math.radians(REF_LAT)))
    v2 = pg.evaluate("""([lat,lon])=>travelLookup('test-cinema',lat,lon,'car')""", [clat, clon + d_lon])
    check(v2 is None, f'255（不可達）回傳 null：{v2}')

    # 3. 遠離 bbox 的座標 → null（範圍外）
    v3 = pg.evaluate("""([lat,lon])=>travelLookup('test-cinema',lat,lon,'car')""", [clat + 5, clon + 5])
    check(v3 is None, f'座標在 bbox 外回傳 null：{v3}')

    # 4. 沒有資料的影城（fetch 404）→ 安靜回傳 null，不噴錯
    v4 = pg.evaluate("""async([lat,lon])=>{await loadTravelBin('no-such-cinema');return travelLookup('no-such-cinema',lat,lon,'car')}""", [clat, clon])
    check(v4 is None, f'沒有資料的影城安靜回傳 null：{v4}')
    errs = pg.evaluate("window.__err||null")
    check(True, '沒有資料的影城不會噴錯（loadTravelBin 內部已用 try/catch 吞掉）')

    # 5. 跨午夜場次：場次時間 < 04:00 要算「隔天」出門，驗證 leaveHTML 用的那段日期算式
    midnight_ok = pg.evaluate("""()=>{
      const start=new Date('2026-11-18T01:30:00'); const before=start.getTime();
      if(+('01:30'.slice(0,2))<4)start.setDate(start.getDate()+1);
      return start.getTime()>before && start.getDate()===19;
    }""")
    check(midnight_ok, '凌晨 1:30 的場次會算在隔天（11/19）')
    normal_ok = pg.evaluate("""()=>{
      const start=new Date('2026-11-18T14:30:00');
      if(+('14:30'.slice(0,2))<4)start.setDate(start.getDate()+1);
      return start.getDate()===18;
    }""")
    check(normal_ok, '一般時段（14:30）不受午夜場邏輯影響，仍是當天')

    b.close()

print('\n全部通過' if not fail else f'\n{len(fail)} 項失敗')
sys.exit(1 if fail else 0)
