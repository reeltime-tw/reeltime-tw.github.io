"""隱私自動測試：模擬手機定位，確認位置不會離開手機。
用法：cd docs && python3 -m http.server 8770 &   再執行  python3 test/privacy.py
檢查項目：
 1. 開 App（還沒同意前）不會向系統要位置
 2. 按「使用目前位置」後能正確判斷縣市（含台北/新北交界）
 3. 整個過程所有網路請求都只連到自己的網站，且沒有任何請求帶著經緯度
 4. 內容安全政策（CSP）有生效：網頁主動連外會被瀏覽器擋下
 5. 手機裡只存縣市名稱，不存經緯度
 6. 計算出發時間（距離、交通推估）也不會有任何對外連線
"""
import sys, json
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8770/'
HOST = urlparse(BASE).netloc
POINTS = [('台北信義區', 25.0330, 121.5654, '台北市'), ('新北三重（隔淡水河）', 25.0620, 121.4870, '新北市'),
          ('新北永和', 25.0080, 121.5150, '新北市'), ('台中西屯', 24.1630, 120.6400, '台中市'), ('高雄前鎮', 22.5950, 120.3070, '高雄市')]
fail = []
def check(ok, msg):
    print(('  ✓ ' if ok else '  ✗ ') + msg)
    if not ok: fail.append(msg)

with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    for name, lat, lng, want in POINTS:
        print(f'▶ {name}')
        ctx = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True,
                            geolocation={'latitude': lat, 'longitude': lng}, permissions=['geolocation'])
        ctx.add_init_script("""(()=>{window.__geoCalls=0;const g=navigator.geolocation;const o=g.getCurrentPosition.bind(g);
          g.getCurrentPosition=(...a)=>{window.__geoCalls++;return o(...a)}})()""")
        pg = ctx.new_page()
        reqs, errs = [], []
        pg.on('request', lambda r: reqs.append(r.url))
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(BASE); pg.wait_for_timeout(1500)
        check(pg.evaluate('window.__geoCalls') == 0, '開啟時沒有自動要位置')
        pg.click('.geo-card [data-act=geo]'); pg.wait_for_timeout(1500)
        got = pg.evaluate('S.city')
        check(got == want, f'判斷縣市：{got}（預期 {want}）')
        # 出發時間：開一部片的第一個場次，算出發時間（用到位置與影城座標）
        pg.click('a[href^="#/movie/"]'); pg.wait_for_timeout(800)
        if pg.query_selector('.cin.fold .tog'):
            pg.click('.cin.fold .tog'); pg.wait_for_timeout(300)
            if pg.query_selector('.cin.open .stub'):
                pg.click('.cin.open .stub'); pg.wait_for_timeout(800)
                check(pg.query_selector('.leave') is not None, '確認場次畫面有出發時間卡片')
        ext = [u for u in reqs if urlparse(u).scheme in ('http', 'https') and urlparse(u).netloc != HOST]
        check(not ext, '沒有對外連線' + ('' if not ext else '：' + ', '.join(ext[:3])))
        coord = [u for u in reqs if str(lat) in u or str(lng) in u or f'{lat:.2f}' in u and f'{lng:.2f}' in u]
        check(not coord, '沒有任何請求帶著經緯度')
        # 路程時間查表（docs/travel/{cinemaId}.bin）：只能是「/travel/影城ID.bin」，不能帶查詢參數、
        # 座標或格子編號（row/col）——這份表本身是網址裡唯一可能含數字的請求，要特別檢查
        travel_reqs = [u for u in reqs if '/travel/' in u]
        bad_travel = [u for u in travel_reqs if '?' in u or not u.rsplit('/travel/', 1)[-1].endswith('.bin')
                      or 'row' in u.lower() or 'col' in u.lower() or 'cell' in u.lower()]
        check(not bad_travel, '路程時間查表只會請求 /travel/{影城ID}.bin，沒有座標或格子參數' +
              ('' if not bad_travel else '：' + ', '.join(bad_travel[:3])))
        # 用瀏覽器的「安全政策攔截」事件判斷，而不是看連線失敗（沒網路時連線本來就會失敗）
        blocked = pg.evaluate("""new Promise(res=>{let hit=false;
          document.addEventListener('securitypolicyviolation',e=>{if(String(e.blockedURI).includes('example.com'))hit=true},{once:true});
          fetch('https://example.com/?lat=1').catch(()=>{}).finally(()=>setTimeout(()=>res(hit?'blocked':'sent'),100))})""")
        check(blocked == 'blocked', '內容安全政策生效：主動連外被擋下')
        stored = pg.evaluate("JSON.stringify(Object.fromEntries(Object.entries(localStorage)))")
        check(str(lat) not in stored and str(lng) not in stored and f'{lat:.2f}' not in stored, '手機只存縣市、不存經緯度')
        check(not errs, '沒有程式錯誤' + ('' if not errs else '：' + errs[0]))
        if name.startswith('台北'):
            pg.screenshot(path='/tmp/p_after.png')
            ctx2 = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, device_scale_factor=2)
            p2 = ctx2.new_page(); p2.goto(BASE); p2.wait_for_timeout(1200); p2.screenshot(path='/tmp/p_card.png')
            p2.click('.geo-card [data-act=privacy]'); p2.wait_for_timeout(400); p2.screenshot(path='/tmp/p_sheet.png'); ctx2.close()
        ctx.close()
    b.close()
print('\n全部通過' if not fail else f'\n{len(fail)} 項失敗')
sys.exit(1 if fail else 0)
