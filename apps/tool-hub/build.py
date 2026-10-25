#!/usr/bin/env python3
"""Build apps/tool-hub/dist/: the 口袋工具箱 catalogue page plus every tool and cover as separate files.

Same approach as apps/game-hub/build.py. Re-run after any tool changes:  python3 apps/tool-hub/build.py
Then publish dist/index.html with every file under dist/ (open/<id>.html, covers/<id>.jpg) to the same artifact URL.
Covers live in covers/<id>.jpg (300x400 screenshots of the tool at 390x520).
"""
import json, pathlib, re, shutil

HERE = pathlib.Path(__file__).resolve().parent
APPS = HERE.parent

# (folder, name, category, blurb). Order inside each category follows research/tool-plan.md.
TOOLS = [
    ('split-bill'        , '分帳小幫手', 'calc', '輸入誰付了多少，算出最少轉帳次數，可複製成文字貼到群組。'),
    ('unit-convert'      , '單位與匯率換算', 'calc', '長度、重量、溫度、面積、坪數、台斤等即時換算，匯率手動填入後離線用。'),
    ('date-calc'         , '日期計算機', 'calc', '兩日期相差天數、加減工作天、紀念日倒數，附農曆對照。'),
    ('discount-calc'     , '小費與折扣計算', 'calc', '打幾折、滿額折、加服務費、多件比價，一眼看出哪個划算。'),
    ('loan-calc'         , '貸款試算', 'calc', '房貸、車貸本息與本金攤還，畫出每期還款表與利息總額。'),
    ('savings-plan'      , '複利與存錢計畫', 'calc', '每月存多少、報酬率幾%，幾年後有多少錢，附成長曲線。'),
    ('body-calc'         , 'BMI 與熱量計算', 'calc', 'BMI、基礎代謝、每日建議熱量與三大營養素分配。'),
    ('sci-calc'          , '科學計算機', 'calc', '大按鍵科學計算機，含歷史紀錄、括號與常用函數。'),
    ('age-zodiac'        , '年齡與星座查詢', 'calc', '輸入生日算出實歲、虛歲、生肖、星座與下次生日倒數。'),
    ('salary-calc'       , '薪資與勞健保試算', 'calc', '輸入月薪、眷屬人數與勞退自提，算出勞保、健保扣款與實領，附雇主成本與年度試算。'),
    ('invoice-lottery'   , '發票對獎', 'calc', '大鍵盤輸入發票末 3 碼即刻對獎，可能中獎再補前 5 碼算出獎別，自存每期號碼與開獎、領獎日期。'),
    ('fuel-power'        , '油錢與電費計算', 'calc', '算這趟開車油錢、分攤與電動車比較；台電累進電價分段算出本期電費，電器多花多少一看就懂。'),
    ('timer-deck'        , '多功能計時器', 'time', '同時跑多個倒數與碼錶，附 Tabata 間歇模式與大字全螢幕。'),
    ('world-clock'       , '世界時鐘', 'time', '多城市時間並列，拖動滑桿找出跨時區都方便的開會時間。'),
    ('breath-guide'      , '呼吸放鬆引導', 'time', '4‑7‑8、方塊呼吸等節奏動畫，搭配柔和音效與震動。'),
    ('noise-mixer'       , '白噪音產生器', 'time', '用 Web Audio 合成雨聲、海浪、風扇、粉紅噪音並自由混音，附睡眠定時。'),
    ('countdown-board'   , '倒數日看板', 'time', '多個重要日子的倒數卡片，可設背景色與圖示。'),
    ('shift-calendar'    , '輪班行事曆', 'time', '設定輪班規則自動排出整月班表，可匯出圖片。'),
    ('pomodoro-todo'     , '番茄專注板', 'time', '番茄鐘計時搭配待辦清單與白噪音，一輪一輪把事情做完。'),
    ('image-squeeze'     , '圖片壓縮轉檔', 'image', '批次壓縮、縮放、轉 JPG/WebP/PNG 並移除 EXIF，全程不上傳。'),
    ('photo-collage'     , '照片拼貼', 'image', '2 到 9 張套版拼貼，拖曳調位置、邊框與圓角，輸出高解析度。'),
    ('image-crop'        , '圖片裁切旋轉', 'image', '依比例（1:1、4:5、16:9）裁切、旋轉、翻轉，手勢縮放。'),
    ('caption-card'      , '字卡產生器', 'image', '在圖片或純色背景加大字標題，適合社群方形與直式尺寸。'),
    ('watermark'         , '浮水印工具', 'image', '批次加文字或圖片浮水印，可調位置、透明度與平鋪。'),
    ('blur-brush'        , '馬賽克與模糊', 'image', '用手指塗抹打碼，遮蓋截圖中的個資。'),
    ('photo-filter'      , '照片濾鏡', 'image', '亮度、對比、色溫、底片風格濾鏡，即時預覽。'),
    ('id-photo'          , '證件照排版', 'image', '裁成一吋、二吋並排滿 4×6 相紙，方便沖印。'),
    ('gif-maker'         , 'GIF 製作器', 'image', '多張圖或短影片轉成 GIF，可調速度與尺寸。'),
    ('video-frames'      , '影片截圖器', 'image', '載入影片逐格瀏覽，擷取高畫質截圖或連拍拼圖。'),
    ('mirror'            , '鏡子', 'image', '前鏡頭當鏡子，凍結畫面放大看細節，附補光外框。'),
    ('exif-tool'         , 'EXIF 檢視與清除', 'image', '看照片藏了什麼：拍攝時間、相機、GPS 位置一目了然，無損清除中繼資料，全程不上傳。'),
    ('image-compare'     , '圖片比較', 'image', '兩張圖左右滑動比較，並排、疊圖、差異標示，雙指縮放同步，可匯出 GIF 與 PNG，全程不上傳。'),
    ('palette-lab'       , '調色盤工作室', 'design', '由照片取色或主色產生配色，檢查對比度，複製 HEX/RGB/HSL。'),
    ('gradient-maker'    , '漸層產生器', 'design', '視覺化調整線性、放射、錐形漸層，輸出 CSS 或圖片。'),
    ('css-shadow'        , '陰影與圓角產生器', 'design', '拖拉調整 box-shadow、圓角、玻璃擬態效果並複製 CSS。'),
    ('icon-maker'        , '圖示與 Favicon 產生器', 'design', '用文字或 emoji 做 App 圖示，輸出各尺寸 PNG 與 favicon。'),
    ('pattern-maker'     , '圖案底紋產生器', 'design', '產生點點、條紋、幾何無縫底紋，輸出 SVG/PNG。'),
    ('screen-ruler'      , '螢幕尺規與取色', 'design', '畫面上的尺規、量角器與網格參考線。'),
    ('md-notes'          , 'Markdown 筆記本', 'text', '左寫右預覽（手機切分頁），自動存本機，匯出 .md/.html。'),
    ('text-kit'          , '文字工具箱', 'text', '字數統計、繁簡轉換、全半形、去空行、排序去重一鍵處理。'),
    ('text-diff'         , '文字比對', 'text', '兩段文字逐字標出差異，適合比對合約或稿件修改。'),
    ('teleprompter'      , '提詞機', 'text', '大字自動捲動，可調速度、鏡像翻轉，錄影時看稿用。'),
    ('sign-pad'          , '手寫簽名板', 'design', '手指寫出平滑簽名，輸出透明背景 PNG。'),
    ('sketch-board'      , '白板畫布', 'design', '無限畫布手繪、形狀、便利貼，可匯出圖片。'),
    ('svg-animator'      , 'SVG 動畫工坊', 'design', '選範本調文字、顏色與緩動，複製出可直接使用的 SVG 動畫程式碼。'),
    ('speed-reader'      , '閱讀速度訓練', 'text', '一次閃一個詞的快速閱讀模式，可調每分鐘字數。'),
    ('phonetic-tag'      , '注音標註', 'text', '中文自動加上注音或拼音（內建常用字字典）。'),
    ('zh-convert'        , '簡繁轉換', 'text', '簡體⇄台灣正體離線轉換，一字多形靠詞組判斷，可開台灣用語，點標記換寫法。'),
    ('pdf-tools'         , 'PDF 工具箱', 'text', '合併、抽頁、排序、旋轉 PDF，圖片也能轉成 PDF；全程在裝置上處理，不上傳。'),
    ('led-banner'        , '跑馬燈看板', 'party', '手機橫放變成大字跑馬燈，演唱會、接機用。'),
    ('json-viewer'       , 'JSON 檢視器', 'dev', '格式化、摺疊、搜尋、驗證 JSON，錯誤處直接標出。'),
    ('encode-box'        , '編碼轉換箱', 'dev', 'Base64、URL、HTML 實體、Unicode 跳脫互轉。'),
    ('hash-uuid'         , '雜湊與 UUID', 'dev', '用 Web Crypto 算檔案或文字的 SHA 雜湊，產生 UUID。'),
    ('regex-lab'         , '正規表示式測試', 'dev', '即時標示匹配與群組，附常用範例。'),
    ('csv-viewer'        , 'CSV 表格檢視', 'dev', '開啟 CSV 排序、篩選、加總，可轉成 JSON 或 Markdown 表格。'),
    ('timestamp'         , '時間戳轉換', 'dev', 'Unix 時間戳與各時區日期互轉。'),
    ('cron-reader'       , 'Cron 解讀器', 'dev', '把 cron 表達式翻成中文並列出接下來的執行時間。'),
    ('base-convert'      , '進位轉換', 'dev', '二、八、十、十六進位與位元運算互轉。'),
    ('chart-maker'       , '簡易圖表產生器', 'dev', '貼上數字就畫出長條、折線、圓餅圖，下載 PNG/SVG。'),
    ('html-playground'   , 'HTML 即時預覽', 'dev', '手機上也能寫 HTML/CSS/JS 並即時看結果。'),
    ('yaml-json'         , 'YAML／JSON／TOML 互轉', 'dev', 'YAML、JSON、TOML 任意互轉並驗證，錯誤標出行列並用白話說明怎麼修。'),
    ('jwt-decode'        , 'JWT 與網址解析', 'dev', '貼上就自動辨識：JWT 拆成彩色三段、解讀到期時間並驗證簽章；網址拆解參數、解多層編碼。全在本機。'),
    ('pass-forge'        , '密碼產生器', 'secure', '高強度密碼或好記詞組密碼，顯示破解時間估計。'),
    ('secret-note'       , '文字加密便條', 'secure', '用密碼以 AES 加密文字，產生可貼出去的密文。'),
    ('qr-maker'          , 'QR 碼產生器', 'secure', '文字、網址、Wi‑Fi、名片轉 QR 碼，可調顏色並下載。'),
    ('qr-scanner'        , 'QR 碼掃描器', 'secure', '用相機即時掃描，或從相簿選圖、貼上截圖，解讀網址、Wi‑Fi 與名片。'),
    ('decide-wheel'      , '隨機決定器', 'party', '自訂轉盤、抽籤、擲骰，聚會吃什麼一轉就決定。'),
    ('team-picker'       , '分組與抽人', 'party', '名單隨機分組、抽出順序，可排除重複。'),
    ('score-board'       , '記分板', 'party', '多人或兩隊大字記分，桌遊、球賽用，可撤銷。'),
    ('finger-pick'       , '手指輪盤', 'party', '大家手指同時按在螢幕上，隨機選出一人（多點觸控）。'),
    ('quick-poll'        , '投票器', 'party', '一台手機輪流投票，最後公布結果與長條圖。'),
    ('coin-flip'         , '猜拳與硬幣', 'party', '擬真硬幣翻轉與猜拳動畫。'),
    ('werewolf-host'     , '誰是臥底／狼人殺主持', 'party', '一台手機傳著看詞或身分，主持人照著夜晚台詞念、計時、記票，自動結算勝負。'),
    ('truth-dare'        , '真心話大冒險', 'party', '轉盤或轉酒瓶抽人，選真心話或大冒險，三百多題內建題庫分三級，可自訂、匯入匯出並記錄每人戰績。'),
    ('flash-cards'       , '單字閃卡', 'learn', '自建卡組，間隔重複排程，左右滑判斷記得與否。'),
    ('math-drill'        , '九九乘法練習', 'learn', '加減乘除限時練習，記錄正確率與進步曲線。'),
    ('typing-trainer'    , '打字練習', 'learn', '中英文打字速度與正確率測驗，標出常錯字鍵。'),
    ('periodic-table'    , '周期表', 'learn', '互動元素週期表，點開看性質與電子組態。'),
    ('morse-code'        , '摩斯電碼', 'learn', '文字與摩斯碼互轉，可用聲音、閃光播放。'),
    ('focus-lab'         , '對焦實驗室', 'learn', '點畫面對焦、調光圈與焦距，即時看懂景深與散景怎麼來。'),
    ('habit-grid'        , '習慣打卡', 'log', '每天點一下打卡，月曆熱力圖呈現連續天數。'),
    ('pocket-ledger'     , '記帳本', 'log', '三秒記一筆，依分類與月份畫圓餅圖與趨勢，匯出 CSV。'),
    ('water-log'         , '喝水提醒', 'log', '記錄每日喝水量，杯子動畫顯示進度。'),
    ('mood-journal'      , '心情日記', 'log', '每日心情表情與短記，看出一個月的情緒走勢。'),
    ('weight-log'        , '體重紀錄', 'log', '記錄體重並畫出移動平均曲線。'),
    ('metronome'         , '節拍器', 'sound', '精準節拍器，可設拍號、重音、漸快練習。'),
    ('tone-gen'          , '頻率產生器', 'sound', '產生指定頻率的正弦波、方波，測喇叭或耳朵聽力範圍。'),
    ('screen-light'      , '螢幕補光', 'sound', '全螢幕純色補光，可調色溫與亮度，附 SOS 閃爍。'),
    ('tuner'             , '調音器', 'sound', '對著麥克風彈一根弦，指針告訴你偏高偏低，支援吉他、烏克麗麗、小提琴、貝斯。'),
    ('decibel-meter'     , '噪音分貝計', 'sound', '用麥克風量環境音量，看即時分貝、平均值與歷史曲線，可匯出 CSV。'),
    ('voice-memo'        , '錄音機', 'sound', '錄音看波形，剪掉頭尾空白再下載，錄音只存在本機。'),
    ('piano-chords'      , '虛擬鋼琴與和弦表', 'sound', '兩個八度的多指觸控鋼琴，查和弦、轉位、音階並直接彈給你聽，按幾個鍵就告訴你是什麼和弦。'),
    ('level-meter'       , '水平儀', 'sensor', '氣泡水平儀、邊緣水平與量角器，可校正、鎖定讀數，水平時變綠並提示音。'),
    ('compass'           , '指南針', 'sensor', '方位角與 16 方位大字顯示，可切換真北／磁北，鎖定目標方向並提示左右轉。'),
    ('gps-speed'         , '測速與里程', 'sensor', '用 GPS 即時測速、記里程並畫出路線，算出平均與最高速度，可匯出 GPX。'),
]

# Tools are published without a doctype (the Artifact tool adds the skeleton), so give each
# embedded copy one, plus a bridge to the hub's window.claude so the downloads capability works.
HEAD = ('<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
        '<style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style>')
BRIDGE = '<script>try{if(!window.claude&&parent!==window&&parent.claude)window.claude=parent.claude}catch(e){}</script>'


def wrap(html):
    if re.match(r'\s*<!doctype', html, re.I):
        return re.sub(r'(<head[^>]*>)', r'\1' + BRIDGE, html, count=1, flags=re.I)
    return HEAD + BRIDGE + '</head><body>' + html + '</body></html>'


def script_json(obj):
    # < keeps "</script>" and "<!--" inside tool HTML from ending the data block.
    return json.dumps(obj, ensure_ascii=False).replace("<", "\\u003c")


def main():
    # dist/ is what gets published: the catalogue page plus one file per tool and cover,
    # so the page itself stays small and a tool is only downloaded when it is opened.
    dist = HERE / "dist"
    if dist.exists():
        shutil.rmtree(dist)
    (dist / "open").mkdir(parents=True)
    (dist / "covers").mkdir()
    meta, total = [], 0
    for tid, name, cat, blurb in TOOLS:
        html = wrap((APPS / tid / "index.html").read_text(encoding="utf-8")).encode()
        (dist / "open" / f"{tid}.html").write_bytes(html)
        shutil.copyfile(HERE / "covers" / f"{tid}.jpg", dist / "covers" / f"{tid}.jpg")
        total += len(html)
        meta.append({"id": tid, "name": name, "cat": cat, "blurb": blurb})
    data = f'<script type="application/json" id="hub-meta">{script_json(meta)}</script>'
    out = (HERE / "template.html").read_text(encoding="utf-8").replace("<!--TOOL_DATA-->", data)
    (dist / "index.html").write_text(out, encoding="utf-8")
    print(f"dist/index.html: {len(out.encode()) / 1024:.0f} KB, {len(TOOLS)} tools ({total / 1048576:.1f} MB in open/)")


if __name__ == "__main__":
    main()
