"""已合併進 validate_gtfs.py（通用版，捷運/公車都能用）。保留此檔只是避免舊的
呼叫處（workflow、文件裡提到的指令）找不到檔案，直接轉呼叫。"""

import runpy
import sys

sys.argv[0] = "validate_gtfs.py"
runpy.run_module("validate_gtfs", run_name="__main__")
