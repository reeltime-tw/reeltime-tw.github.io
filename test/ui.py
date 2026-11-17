from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
    pg=b.new_page(viewport={'width':390,'height':844})
    errs=[]
    pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.on('console',lambda m:errs.append(m.text) if m.type=='error' and 'Failed to load resource' not in m.text else None)
    pg.goto('http://localhost:8765/'); pg.wait_for_timeout(800)
    pg.screenshot(path='test/u1.png')
    pg.click('.mv'); pg.wait_for_timeout(300); pg.screenshot(path='test/u2.png')
    pg.click('.sheet .t'); pg.wait_for_timeout(200); print('cta',pg.get_attribute('.cta','href')); pg.screenshot(path='test/u3.png')
    pg.click('[data-close]') if pg.query_selector('[data-close]') else pg.keyboard.press('Escape')
    pg.keyboard.press('Escape')
    pg.click('[data-sec=soon]'); pg.wait_for_timeout(200); pg.screenshot(path='test/u4.png')
    pg.click('.mv'); pg.wait_for_timeout(300); pg.screenshot(path='test/u5.png'); pg.keyboard.press('Escape')
    pg.click('[data-tab=cinemas]'); pg.wait_for_timeout(200); pg.screenshot(path='test/u6.png')
    pg.click('#btnData'); pg.wait_for_timeout(200); pg.screenshot(path='test/u7.png')
    print('errors',errs)
    b.close()
