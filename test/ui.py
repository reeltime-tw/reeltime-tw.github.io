# 介面截圖測試（先在 docs/ 開本機伺服器於 8765 埠）
# 流程：首頁 → 選縣市 → 電影頁 → 點場次 → 手機返回鍵 → 影城 → 影城頁 → 即將上映 → 搜尋
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch()
    pg=b.new_page(viewport={'width':390,'height':844})
    errs=[]
    pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.on('console',lambda m:errs.append(m.text) if m.type=='error' and 'Failed to load resource' not in m.text else None)
    pg.goto('http://localhost:8765/#/'); pg.wait_for_timeout(1000)
    pg.screenshot(path='test/u1-home.png')
    pg.click('[data-act=loc]'); pg.wait_for_timeout(300); pg.click('[data-setcity="台北市"]'); pg.wait_for_timeout(300)
    pg.click('.mv'); pg.wait_for_timeout(400); pg.screenshot(path='test/u2-movie.png')
    pg.click('.stub'); pg.wait_for_timeout(300); print('訂票連結', pg.get_attribute('.sheet .btn.pri','href')); pg.screenshot(path='test/u3-ticket.png')
    pg.go_back(); pg.wait_for_timeout(200); print('返回後面板已關', pg.query_selector('.sheet') is None)
    pg.click('[data-nav=cinemas]'); pg.wait_for_timeout(300); pg.screenshot(path='test/u4-cinemas.png')
    pg.click('.row a.main'); pg.wait_for_timeout(300); pg.screenshot(path='test/u5-cinema.png')
    pg.click('[data-nav=soon]'); pg.wait_for_timeout(300); pg.screenshot(path='test/u6-soon.png')
    pg.click('[data-act=search]'); pg.fill('#q','柯南'); pg.wait_for_timeout(200); pg.screenshot(path='test/u7-search.png')
    print('errors',errs)
    b.close()
