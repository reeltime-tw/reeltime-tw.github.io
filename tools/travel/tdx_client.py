"""TDX API 共用用戶端：登入、帶重試與間隔的 GET。

實測發現：連續呼叫太快會收到 HTTP 200 但內容是
{"message": "API rate limit exceeded"} 的錯誤（不是用 429 狀態碼表示），
所以不能只看 HTTP code，要檢查回應內容。

環境變數 TDX_CLIENT_ID / TDX_CLIENT_SECRET 需先設定。
"""

from __future__ import annotations

import os
import time
import urllib.error
import urllib.parse
import urllib.request
import json

TOKEN_URL = "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token"
BASE = "https://tdx.transportdata.tw/api/basic"

_token = None
_token_at = 0.0


def get_token(force: bool = False, max_retries: int = 6) -> str:
    """換 token。這裡也要重試——2026-11-18 晚間實測發現 TDX 的登入端點本身
    偶爾會回 500（跟資料端點的限流是兩回事），原本沒重試，一次 500 就讓
    整個抓取流程直接失敗（而且因為是最原始的 urllib.error.HTTPError 往外丟，
    連 get_json() 自己的重試邏輯都沒機會跑到）。"""
    global _token, _token_at
    if _token and not force and time.time() - _token_at < 60 * 20:
        return _token
    client_id = os.environ["TDX_CLIENT_ID"]
    client_secret = os.environ["TDX_CLIENT_SECRET"]
    data = urllib.parse.urlencode(
        {
            "grant_type": "client_credentials",
            "client_id": client_id,
            "client_secret": client_secret,
        }
    ).encode()
    delay = 2.0
    last_err: Exception | None = None
    for attempt in range(max_retries):
        req = urllib.request.Request(
            TOKEN_URL, data=data, headers={"content-type": "application/x-www-form-urlencoded"}
        )
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                body = json.load(resp)
            _token = body["access_token"]
            _token_at = time.time()
            return _token
        except (urllib.error.HTTPError, urllib.error.URLError) as e:
            last_err = e
            # 2026-11-19：連續三次在不同時段都是同樣的 400，不太像單純流量
            # 限制那種忽好忽壞，比較像是認證本身出問題——把 TDX 實際回傳的
            # 錯誤內容印出來（不是密鑰本身，是 TDX 的回應，印出來才看得出
            # 是不是 invalid_client 之類的具體原因）。只在第一次嘗試印，
            # 避免 6 次重試洗版洗出一樣的內容。
            if attempt == 0 and hasattr(e, "read"):
                try:
                    body_preview = e.read()[:500]
                    print(f"  [tdx] 登入端點錯誤回應內容：{body_preview!r}")
                except Exception:
                    pass
            print(f"  [tdx] 登入端點失敗（{e}），{delay:.1f}s 後重試（第 {attempt + 1}/{max_retries} 次）")
            time.sleep(delay)
            delay = min(delay * 2, 60)
    raise TdxError(f"登入 {max_retries} 次後仍失敗: {last_err}")


class TdxError(Exception):
    pass


def get_json(path: str, params: dict | None = None, *, min_interval: float = 1.2, max_retries: int = 8):
    """對 TDX basic API 發一個 GET，回傳解析後的 JSON。

    path 例如 "/v2/Rail/Metro/Station/TRTC"（不含網域與 /api/basic 前綴）。
    會自動補上 $format=JSON。遇到 rate limit 訊息會等待後重試（指數退避）。
    """
    q = dict(params or {})
    q.setdefault("$format", "JSON")
    url = BASE + path + "?" + urllib.parse.urlencode(q)

    delay = min_interval
    last_err = None
    for attempt in range(max_retries):
        token = get_token()
        req = urllib.request.Request(url, headers={"authorization": f"Bearer {token}"})
        had_http_error = False
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                raw = resp.read()
        except (urllib.error.HTTPError, urllib.error.URLError) as e:
            if getattr(e, "code", None) == 401:
                get_token(force=True)
                time.sleep(delay)
                delay = min(delay * 2, 60)
                continue
            had_http_error = True
            raw = e.read() if hasattr(e, "read") else b""
            last_err = TdxError(f"HTTP 錯誤：{e}；body[:300]={raw[:300]!r}")

        # 就算是錯誤回應（像之前遇到的 500），body 也可能恰好是合法 JSON
        # （例如 {"error": "..."}），這種情況也要當失敗重試，不能因為
        # json.loads 沒丟例外就誤判成功。
        if had_http_error:
            print(f"  [tdx] {path} 失敗（{last_err}），{delay:.1f}s 後重試（第 {attempt + 1}/{max_retries} 次）")
            time.sleep(delay)
            delay = min(delay * 2, 60)
            continue

        try:
            body = json.loads(raw)
        except Exception as e:
            last_err = TdxError(f"無法解析 JSON: {e}; body[:200]={raw[:200]!r}")
            time.sleep(delay)
            delay = min(delay * 2, 60)
            continue

        if isinstance(body, dict) and body.get("message") and "rate limit" in str(body["message"]).lower():
            print(f"  [tdx] rate limited on {path}，{delay:.1f}s 後重試（第 {attempt + 1} 次）")
            time.sleep(delay)
            delay = min(delay * 2, 60)
            continue

        time.sleep(min_interval)  # 成功也稍微停一下，避免下一次連續呼叫觸發限制
        return body

    raise last_err or TdxError(f"重試 {max_retries} 次後仍失敗: {path}")
