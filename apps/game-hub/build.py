#!/usr/bin/env python3
"""Build apps/game-hub/dist/: the 口袋遊樂場 catalogue page plus every game and cover as separate files.

Re-run after any game changes:  python3 apps/game-hub/build.py
Then publish dist/index.html with every file under dist/ (play/<id>.html, covers/<id>.jpg) to the same artifact URL.
Covers live in covers/<id>.jpg (300x400 screenshots).
"""
import json, pathlib, re, shutil

HERE = pathlib.Path(__file__).resolve().parent
APPS = HERE.parent

# Order follows the project's priority: puzzle and reaction games first.
GAMES = [
    ("kiln-2048",        "窯變 2048",   "puzzle", False, "滑動合併陶瓷，九種玩法、五套窯色。"),
    ("antikythera",      "天機齒輪",   "puzzle", True,  "把齒輪擺上銅釘，接通古希臘天象儀。"),
    ("foldline",         "摺紙旋律路", "puzzle", True,  "轉動、翻摺紙片，接出一條會唱歌的路。"),
    ("light-path",       "光路折鏡",   "puzzle", True,  "轉動鏡子，讓彩色雷射點亮每顆水晶。"),
    ("ice-slide",        "冰原企鵝",   "puzzle", True,  "企鵝一滑到底，吃光魚兒再回冰屋。"),
    ("one-stroke",       "一筆繪境",   "puzzle", True,  "一筆走遍每一格，依序蓋過朱印。"),
    ("pipe-flow",        "銅管水坊",   "puzzle", True,  "轉動銅管，讓水流到每一個出口。"),
    ("parking-escape",   "霓虹夜停",   "puzzle", True,  "滑開擋路的車，讓紅色跑車衝出停車場。"),
    ("color-sort",       "鍊金藥劑室", "puzzle", True,  "倒來倒去，讓每支試管只剩一種藥水。"),
    ("block-fill",       "榫卯木格",   "puzzle", False, "把木塊拼進九宮盤，填滿就消除。"),
    ("nonogram",         "十字繡坊",   "puzzle", True,  "依數字提示繡出隱藏的小圖。"),
    ("flip-lights",      "夜市花燈",   "puzzle", True,  "點亮一盞，鄰居跟著變，讓整片燈籠全亮。"),
    ("rope-cut",         "森林糖果樹屋", "puzzle", True, "切斷藤蔓，讓糖果擺進小狐狸嘴裡。"),
    ("color-push",       "積木推推樂", "puzzle", True,  "一推整排動，把積木推回同色格。"),
    ("sudoku",           "和紙數獨",   "puzzle", True,  "墨印和紙上的經典數獨，一百關技巧漸進。"),
    ("minesweeper", "極地探冰", "puzzle", True, "冰原踩地雷，保證不用猜，一百關越鑿越深。"),
    ("queens", "花園女王", "puzzle", True, "每行每列每塊花圃一位女王，互不相鄰。"),
    ("hashi",            "群島橋匠",   "puzzle", True,  "依島上數字架橋，把整片群島連起來。"),
    ("block-roll", "石碑翻滾", "puzzle", True, "翻滾長方石碑，直立落進雲端神殿的洞口。"),
    ("tangram", "剪紙七巧", "puzzle", True, "用七塊紅紙拼出墨色剪影，拼完變窗花。"),
    ("link-match", "糖果連連看", "puzzle", True, "兩轉彎內連起相同甜點，限時清空糖果屋。"),
    ("gem-match", "深海珍珠", "puzzle", True, "交換海洋寶物三連消，連鎖點亮珊瑚礁。"),
    ("peg-solitaire", "玉珠孤棋", "puzzle", True, "玉珠互跳，最後只留一顆在金框裡。"),
    ("gravity-maze", "星環迷宮", "puzzle", True, "旋轉太空艙，讓能量珠靠重力滾進出口。"),
    ("mirror-walk", "鏡湖雙影", "puzzle", True, "一個指令動兩隻狐狸，左右相反，同時抵達。"),
    ("kakuro", "馬賽克數和", "puzzle", True, "填數字湊出每段總和，拼出地中海馬賽克。"),
    ("klotski", "三國華容道", "puzzle", True, "滑動木雕將領，讓曹操從華容道脫身。"),
    ("mini-golf", "果嶺彈珠", "puzzle", True, "拖曳擊球，闖過紙模型迷你高爾夫百洞。"),
    ("idiom-guess", "成語猜字", "puzzle", True, "從字牌挑四字猜成語，紅印對位金底在內，百關越猜越難。"),
    ("photo-jigsaw", "自訂拼圖", "puzzle", False, "把自己的照片切成真正的拼圖片，吸附連接、旋轉挑戰。"),
    ("sokoban", "推箱子", "puzzle", True, "老茶行倉庫裡把茶箱推回竹蓆，一百關由淺入深。"),
    ("vibe-arcade",      "霓虹街機",   "reflex", False, "閃電反應、疊塔、記憶、拼盤四台機台。"),
    ("knife-target",     "飛刀神射",   "reflex", True,  "對旋轉木靶擲飛刀，別碰到已插的刀。"),
    ("push-zombie",      "推推殭屍",   "reflex", False, "三隻殭屍輪流爬出來，只敲全出來的那隻。"),
    ("shot-zombie",      "射擊殭屍",   "reflex", False, "射倒最前面那隻，整排往前推，拚手速。"),
    ("twin-lanes",       "雙軌疾行",   "reflex", False, "左右手各控一位跑者，吃圓閃方。"),
    ("orbit-hop",        "星軌跳躍",   "reflex", False, "抓準時機，從一顆星球彈射到下一顆。"),
    ("slide-rush",       "滑水衝刺",   "reflex", True,  "左右拖曳過彎搶名次，一道比一道陡。"),
    ("rhythm-tap",       "合成波節拍", "reflex", True,  "跟著即時合成的音樂敲下四軌音符。"),
    ("dodge-rush",       "螢火迴避",   "reflex", False, "拖著螢火蟲穿過漫天彈幕，撐越久越好。"),
    ("chain-burst",      "深海螢光",   "reflex", True,  "只點一下，讓水母一隻接一隻連鎖發光。"),
    ("hoop-king",        "投籃王",     "reflex", True,  "向上一滑出手，空心入網拿高分。"),
    ("brick-balls",      "幾何霓虹磚", "reflex", True,  "瞄準一次發射整串彈珠，打碎所有磚塊。"),
    ("timing-slash",     "月下居合",   "reflex", True,  "刀光繞月，在通過符紙的瞬間出手。"),
    ("snake-glide",      "苔原光蛇",   "reflex", False, "滑動轉彎，穿過傳送門吃個不停。"),
    ("mental-math",      "粉筆心算",   "reflex", False, "黑板落下的算式，搶在觸底前點出答案。"),
    ("falling-blocks", "星塊落陣", "reflex", False, "滑動旋轉排滿星塊，消行點亮夜空。"),
    ("flap-glider", "紙鶴穿梭", "reflex", False, "點一下振翅，紙鶴穿過黃昏竹林縫隙。"),
    ("color-rings", "光環穿越", "reflex", False, "點擊彈跳，只從同色光環穿過。"),
    ("helix-drop", "螺旋墜落", "reflex", False, "轉動糖果塔，讓果凍球一路砸碎墜落。"),
    ("fruit-slash", "果園快刀", "reflex", False, "劃開拋起的水果，一刀多顆連切，小心刺蝟栗子。"),
    ("frog-crossing", "小蛙過河", "reflex", True, "跳過車流、踩木過河，送小青蛙回荷葉窩。"),
    ("air-hockey", "霓虹冰球", "reflex", True, "拖曳推桿，擊敗 100 位霓虹機器人。"),
    ("color-eye", "辨色眼力", "reflex", False, "一片顏料裡找出唯一不同的那格。"),
    ("firefly-maze", "螢火迷宮", "reflex", True, "螢火蟲吃光點，強光反擊影蛾。"),
    ("catch-basket", "籃接豐收", "reflex", False, "拖籃接秋果，滿籃倒出換高分。"),
    ("doodle-shooter",   "塗鴉射擊",   "action", True,  "筆記本上的塗鴉射擊，關底有 Boss。"),
    ("pixel-wizard",     "像素法師",   "action", True,  "切換咒語擊退一波波怪物的像素法師。"),
    ("slingshot-siege", "石砲攻城記", "action", True, "拉弓彈射石彈，轟垮城堡打倒盔甲地精。"),
    ("asteroid-storm", "隕石風暴", "action", False, "雙搖桿霓虹射擊，擊碎分裂隕石撐過無盡波次。"),
    ("cannon-duel", "山頭砲戰", "action", True, "拖曳瞄準越過山頭，炸翻電腦砲台。"),
    ("tower-defense", "菇菇守城", "action", True, "種蘑菇塔擋害蟲，守護蘑菇村。"),
    ("bomb-maze", "鞭炮貓老街", "action", True, "橘貓放鞭炮炸開紅磚，清光怪物找廟門，百關闖關加電腦對戰。"),
    ("bullet-hell", "彈幕射擊", "action", False, "夜櫻祭彈幕射擊，相對觸控閃彈、擦彈、三面 Boss 符卡。"),
    ("tank-battle", "坦克大戰", "action", True, "守住老鷹基地，打穿磚牆擊退百關戰車大軍。"),
    ("xiangqi", "中國象棋", "board", True, "對弈五級電腦，破解百關連將殺局。"),
    ("chess", "西洋棋", "board", True, "對戰五級電腦，挑戰百道將死殘局。"),
    ("gomoku", "五子棋", "board", True, "對戰五級電腦，挑戰百關限步連五。"),
    ("othello", "黑白棋", "board", False, "翡翠賭桌翻轉棋，五級電腦對弈。"),
    ("go9", "九路圍棋", "board", False, "禪庭石庭對電腦下圍棋，自動判死活數子。"),
    ("connect-four", "四子連線", "board", False, "投子連四，挑戰五級電腦與 Pop Out。"),
    ("banqi", "象棋暗棋", "board", False, "翻棋比大小，炮打隔山兵吃帥。"),
    ("chinese-checkers", "中國跳棋", "board", False, "六角星上連跳搭橋，對戰一到五台電腦。"),
    ("draughts", "國際跳棋", "board", False, "巴西・俄式・英美跳棋，有吃必吃連吃升王。"),
    ("dots-and-boxes", "點格棋", "board", False, "輪流畫線圍格子，讓兩格奪控制。"),
    ("hex", "六角連通", "board", False, "紅連上下藍連左右，蜂巢極光六角棋。"),
    ("ultimate-tictactoe", "九宮井字", "board", False, "下哪格送對手去哪盤，五級電腦對弈。"),
    ("mancala", "播棋", "board", False, "彩豆撒入木坑，連動搶收鬥電腦。"),
    ("aeroplane-chess", "飛行棋", "board", False, "擲骰起飛撞機回場，對戰三台電腦。"),
    ("backgammon", "雙陸棋", "board", False, "擲骰打擊移出，五級電腦與加倍骰。"),
    ("shogi", "日本將棋", "board", False, "吃子可打入的日本將棋，五級電腦與詰將棋"),
    ("monopoly", "大富翁", "board", False, "台灣環島買地蓋房，和三台電腦拚身家。"),
    ("klondike-solitaire", "經典接龍", "card", True, "綠呢牌桌上的經典接龍，百局保證可解。"),
    ("spider-solitaire", "蜘蛛接龍", "card", True, "月光蛛網下理順八串牌，一到四種花色。"),
    ("freecell", "新接龍", "card", True, "青花瓷桌上的 FreeCell，百局皆可解。"),
    ("pyramid-solitaire", "金字塔接龍", "card", True, "兩張湊十三，拆光黃昏沙丘上的金字塔。"),
    ("mahjong-solitaire", "麻將接龍", "card", True, "竹林茶室裡拆牌山，百關層疊配對。"),
    ("big-two", "大老二", "card", False, "台灣規則大老二，和三位夜市牌友拼清手。"),
    ("taiwan-mahjong", "台灣麻將", "card", False, "16 張台麻，聽牌提示與台數一次算清。"),
    ("texas-holdem", "德州撲克", "card", False, "深夜爵士廳的六人桌，和五位電腦鬥智。"),
    ("blackjack", "二十一點", "card", False, "裝飾藝術列車上對莊家，點數越滾越高"),
    ("hearts", "紅心大戰", "card", False, "躲開紅心與黑桃 Q，或大膽射月。"),
    ("pick-red-points", "撿紅點", "card", False, "柑仔店桌上湊十吃牌，紅點越多越贏。"),
    ("sevens", "排七", "card", False, "從 7 往兩邊接牌，卡住對手讓他蓋大牌。"),
    ("old-maid", "抽鬼牌", "card", False, "馬戲團裡抽牌配對，別讓小丑留在你手上。"),
    ("yacht-dice", "快艇骰子", "card", False, "擲五顆骰填十三格，乘著快艇遠航刷分。"),
    ("liars-dice", "吹牛骰", "card", False, "燈籠茶館裡喊點開盅，看穿電腦的虛張聲勢。"),
    ("dou-dizhu", "鬥地主", "card", False, "田莊牌桌叫地主，一人鬥兩位電腦農民。"),
    ("thirteen-cards", "十三支", "card", False, "十三張分三墩，和三位牌友比牌、打槍拚全壘打。"),
    ("pressure-washer",  "高壓洗淨",   "calm",   True,  "用水柱沖掉污垢，看著畫面一點點變乾淨。"),
    ("word-world",       "字字成真",   "calm",   False, "打出一個詞，它就出現在小世界裡。"),
    ("warehouse-command","倉儲指揮所", "world",  False, "派遣堆高機搬貨出貨，衝高倉庫吞吐量。"),
    ("atlantis",         "波塞迪亞",   "world",  False, "在夕陽下的亞特蘭提斯城自由漫步。"),
    ("eco-aquarium", "生態水族箱", "world", False, "餵食、換水、調燈光，養一缸會自己過日子的小生態。"),
    ("clearwater",       "清淺水灣",   "calm",   False, "輕觸卵石淺灘激起漣漪，看光影在水底晃動。"),
    ("rain-on-glass",    "雨窗",       "calm",   False, "雨夜起霧的窗，用手指在玻璃上寫字作畫。"),
    ("zen-sand", "禪意沙畫", "calm", False, "在枯山水沙盤上耙出紋路，線條自動繞過石頭。"),
]


# Games run in a srcdoc iframe; this hands them the hub's window.claude so online play (room) works inside the hub.
BRIDGE = '<script>try{if(!window.claude&&parent!==window&&parent.claude)window.claude=parent.claude}catch(e){}</script>'


def bridged(html):
    if re.search(r'<head[^>]*>', html, re.I):
        return re.sub(r'(<head[^>]*>)', lambda m: m.group(1) + BRIDGE, html, count=1, flags=re.I)
    return BRIDGE + html


def main():
    # dist/ is what gets published: the catalogue page plus one file per game and cover,
    # so the page itself stays small and a game is only downloaded when it is opened.
    dist = HERE / "dist"
    if dist.exists():
        shutil.rmtree(dist)
    (dist / "play").mkdir(parents=True)
    (dist / "covers").mkdir()
    meta, total = [], 0
    for gid, name, cat, levels, blurb in GAMES:
        html = bridged((APPS / gid / "index.html").read_text(encoding="utf-8")).encode()
        (dist / "play" / f"{gid}.html").write_bytes(html)
        shutil.copyfile(HERE / "covers" / f"{gid}.jpg", dist / "covers" / f"{gid}.jpg")
        total += len(html)
        meta.append({"id": gid, "name": name, "cat": cat, "levels": levels, "blurb": blurb})
    data = '<script type="application/json" id="hub-meta">' + json.dumps(meta, ensure_ascii=False).replace("<", "\\u003c") + "</script>"
    out = (HERE / "template.html").read_text(encoding="utf-8").replace("<!--GAME_DATA-->", data)
    (dist / "index.html").write_text(out, encoding="utf-8")
    print(f"dist/index.html: {len(out.encode()) / 1024:.0f} KB, {len(GAMES)} games ({total / 1048576:.1f} MB in play/)")


if __name__ == "__main__":
    main()
