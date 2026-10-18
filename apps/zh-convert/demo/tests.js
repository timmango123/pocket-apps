// Conversion tests for 簡繁轉換 (zh-convert). Loads the engine between the CORE markers of ../index.html.
// Usage: node tests.js
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const ZC = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return ZC;')();
let pass = 0, fail = 0;
function ok(c, msg) { if (c) pass++; else { fail++; console.log('FAIL', msg); } }
const s2t = (t, o) => ZC.join(ZC.convert(t, Object.assign({ dir: 's2t' }, o || {})));
const t2s = (t, o) => ZC.join(ZC.convert(t, Object.assign({ dir: 't2s' }, o || {})));
function eq(fn, src, want, label) { const got = fn(src); ok(got === want, `${label || ''} ${src} → ${got} (want ${want})`); }

// ---- file budget ----
ok(Buffer.byteLength(html) < 600 * 1024, 'index.html under 600 KB (' + Buffer.byteLength(html) + ')');
ok(ZC.build().sp.m.size > 9000 && ZC.build().sc.size > 3500, 'tables loaded (phrases ' + ZC.build().sp.m.size + ', chars ' + ZC.build().sc.size + ')');

// ---- simplified -> traditional (Taiwan): one-to-many resolved by phrases ----
const S2T = `头发>頭髮 发展>發展 干净>乾淨 干部>幹部 后来>後來 皇后>皇后 里面>裡面 公里>公里 面条>麵條 钟表>鐘錶 只有>只有 一只>一隻
系统>系統 关系>關係 联系>聯繫 复杂>複雜 重复>重複 答复>答覆 台风>颱風 松树>松樹 放松>放鬆 制度>制度 制造>製造
什么>什麼 几个>幾個 范围>範圍 丑陋>醜陋 小丑>小丑 游泳>游泳 旅游>旅遊 合并>合併 并且>並且 同志>同志 志愿>志願 历史>歷史 日历>日曆
征求>徵求 象征>象徵 出征>出征 征服>征服 曲折>曲折 歌曲>歌曲 酒曲>酒麴 占领>佔領 占卜>占卜 咸丰>咸豐 咸鱼>鹹魚 于是>於是 杰出>傑出 尽管>儘管 尽力>盡力
云南>雲南 划船>划船 计划>計畫 向导>嚮導 导入>導入 伙伴>夥伴 蒙古>蒙古 蒙蔽>矇蔽 郁闷>鬱悶 复习>複習 复兴>復興 恢复>恢復 复印>複印 回复>回覆 修复>修復
若干>若干 饼干>餅乾 干杯>乾杯 干脆>乾脆 干扰>干擾 干涉>干涉 干活>幹活 干嘛>幹嘛 干旱>乾旱 干燥>乾燥 干预>干預 干线>幹線 天干地支>天干地支 主干>主幹 树干>樹幹 干货>乾貨 才干>才幹 能干>能幹 豆腐干>豆腐乾 干妈>乾媽 晾干>晾乾 外强中干>外強中乾 干细胞>幹細胞
这里>這裡 那里>那裡 哪里>哪裡 心里>心裡 手里>手裡 里程碑>里程碑 英里>英里 邻里>鄰里 故里>故里 里头>裡頭 表里如一>表裡如一 公里数>公里數
当天>當天 上当>上當 当铺>當鋪 妥当>妥當 相当>相當 斗争>鬥爭 战斗>戰鬥 北斗星>北斗星 一斗米>一斗米 漏斗>漏斗 烟斗>菸斗 斗篷>斗篷 奋斗>奮鬥
余下>餘下 剩余>剩餘 业余>業餘 余额>餘額 采访>採訪 采用>採用 风采>風采 精彩>精彩 山谷>山谷 谷物>穀物 稻谷>稻穀 峡谷>峽谷 谷歌>谷歌
困难>困難 困倦>睏倦 饥饿>飢餓 叶子>葉子 树叶>樹葉 适合>適合 舒适>舒適 借钱>借錢 借口>藉口 凭借>憑藉 借助>藉助 借鉴>借鑑
冲动>衝動 冲突>衝突 冲洗>沖洗 冲浪>衝浪 冲泡>沖泡 气冲冲>氣沖沖 栏杆>欄杆 笔杆>筆桿 杠杆>槓桿 杆菌>桿菌 电线杆>電線杆
胡说>胡說 胡萝卜>胡蘿蔔 胡须>鬍鬚 胡子>鬍子 二胡>二胡 必须>必須 须知>須知 触须>觸鬚 舍得>捨得 宿舍>宿舍 舍弃>捨棄 施舍>施捨 退避三舍>退避三舍
涂料>塗料 糊涂>糊塗 折叠>摺疊 折扣>折扣 打折>打折 骨折>骨折 存折>存摺 奏折>奏摺 蔑视>蔑視 污蔑>汙衊 怎么>怎麼 那么>那麼 老幺>老么
发现>發現 理发>理髮 毛发>毛髮 发型>髮型 假发>假髮 白发>白髮 卷发>捲髮 洗发水>洗髮精 千钧一发>千鈞一髮 令人发指>令人髮指 脱发>脫髮 发际线>髮際線 发夹>髮夾
系鞋带>繫鞋帶 系上安全带>繫上安全帶 系领带>繫領帶 维系>維繫 系数>係數 中文系>中文系 太阳系>太陽系 系统性>系統性
复制>複製 复述>複述 复活>復活 复仇>復仇 复原>復原 复合>複合 复数>複數 复旦>復旦 复查>複查 复赛>複賽 复核>複核 复审>複審 复试>複試 康复>康復 报复>報復 复苏>復甦 复古>復古 收复>收復 光复>光復 复辟>復辟 批复>批覆 反复>反覆 复发>復發
时钟>時鐘 闹钟>鬧鐘 钟头>鐘頭 分钟>分鐘 钟声>鐘聲 钟楼>鐘樓 钟情>鍾情 钟爱>鍾愛 一见钟情>一見鍾情 钟馗>鍾馗 钟乳石>鐘乳石 警钟>警鐘 挂钟>掛鐘
面包>麵包 面粉>麵粉 面食>麵食 面馆>麵館 面筋>麵筋 方便面>方便麵 拉面>拉麵 炒面>炒麵 泡面>泡麵 凉面>涼麵 面前>面前 面对>面對 面积>面積 面子>面子 见面>見面 表面>表面 里面>裡面 外面>外面 后面>後面 全面>全面 画面>畫面 桌面>桌面 面试>面試 面膜>面膜 牛肉面>牛肉麵 面包车>麵包車 面线>麵線
后天>後天 以后>以後 然后>然後 最后>最後 后悔>後悔 后果>後果 落后>落後 王后>王后 太后>太后 后宫>後宮 皇太后>皇太后 后羿>后羿 天后>天后 影后>影后 后台>後台 后备箱>後車廂
只要>只要 两只>兩隻 几只>幾隻 这只>這隻 只身>隻身 船只>船隻 只字未提>隻字未提 形单影只>形單影隻
注册>註冊 注意>注意 注释>註釋 注明>註明 注销>註銷 备注>備註 关注>關注 专注>專注 孤注一掷>孤注一擲
准备>準備 准确>準確 批准>批准 标准>標準 水准>水準 准时>準時 不准>不准 准许>准許 瞄准>瞄準 核准>核准
制作>製作 制定>制定 制服>制服 制止>制止 控制>控制 限制>限制 编制>編制 体制>體制 复制>複製 研制>研製 腌制>醃製 录制>錄製 粗制滥造>粗製濫造 定制>訂製 自制力>自制力
几乎>幾乎 几何>幾何 几率>機率 茶几>茶几 窗明几净>窗明几淨 所剩无几>所剩無幾
咸阳>咸陽 咸菜>鹹菜 老少咸宜>老少咸宜 咸鸭蛋>鹹鴨蛋 游戏>遊戲 游客>遊客 游行>遊行 游泳池>游泳池 导游>導遊 游击>游擊 游牧>游牧 上游>上游 游标>游標 电子游戏>電子遊戲 游轮>遊輪
周末>週末 周年>週年 周期>週期 周刊>週刊 一周>一週 上周>上週 每周>每週 周围>周圍 周到>周到 周杰伦>周杰倫 周朝>周朝 圆周>圓周 周转>週轉
规划>規劃 策划>策劃 划分>劃分 划算>划算 划桨>划槳 划破>劃破 划时代>劃時代 比划>比劃
由于>由於 对于>對於 关于>關於 属于>屬於 等于>等於 终于>終於 至于>至於 不至于>不至於 姓于>姓于 于谦>于謙 单于>單于
范例>範例 模范>模範 示范>示範 规范>規範 防范>防範 师范>師範 范仲淹>范仲淹 范冰冰>范冰冰
台湾>台灣 台北>台北 台中>台中 舞台>舞台 平台>平台 柜台>櫃檯 电视台>電視台 阳台>陽台 讲台>講台 台阶>台階 台面>檯面 台灯>檯燈 台球>檯球 写字台>寫字檯 台词>台詞 台风眼>颱風眼 台商>台商 台积电>台積電
松鼠>松鼠 松柏>松柏 松子>松子 松下>松下 轻松>輕鬆 松开>鬆開 松手>鬆手 松懈>鬆懈 宽松>寬鬆 蓬松>蓬鬆 肉松>肉鬆 松饼>鬆餅 松一口气>鬆一口氣
占据>佔據 占有>佔有 占用>佔用 占比>佔比 占便宜>佔便宜 霸占>霸佔 独占>獨佔 占星>占星 占了>佔了
借书>借書 借阅>借閱 借条>借條 借由>藉由 借着>藉著 借此>藉此 借故>藉故 借机>藉機 借刀杀人>借刀殺人 借题发挥>借題發揮
发布>發布 公布>公布 宣布>宣布 分布>分布 布局>布局 布置>布置 遍布>遍布
了解>了解 不了解>不了解 明了>明瞭 一目了然>一目瞭然 了望>瞭望
么>麼 要么>要麼 多么>多麼 幺妹>么妹
干得好>幹得好 干什么>幹什麼 干一场>幹一場 实干>實幹 苦干>苦幹 干完>幹完 干过>幹過 干不了>幹不了
`;
for (const line of S2T.trim().split('\n')) for (const e of line.trim().split(/\s+/)) { const [a, b] = e.split('>'); eq(s2t, a, b, 's2t'); }

// ---- sentences ----
const SENT = [
  ['他的头发很长，公司的发展很快。', '他的頭髮很長，公司的發展很快。'],
  ['请把房间打扫干净，干部们都来了，若干个问题。', '請把房間打掃乾淨，幹部們都來了，若干個問題。'],
  ['后来皇后到了里面，走了三公里，吃了一碗面条，看了钟表，只有一只猫。', '後來皇后到了裡面，走了三公里，吃了一碗麵條，看了鐘錶，只有一隻貓。'],
  ['系统和关系，联系我们，复杂的事情重复做，答复他，台风来了，松树下放松一下，制度和制造业。', '系統和關係，聯繫我們，複雜的事情重複做，答覆他，颱風來了，松樹下放鬆一下，制度和製造業。'],
  ['他是个很有才干的干部，在单位里干得很出色。', '他是個很有才幹的幹部，在單位裡幹得很出色。'],
  ['这只小狗很可爱，只要你叫它，它就会摇尾巴。', '這隻小狗很可愛，只要你叫它，它就會搖尾巴。'],
  ['我的头发该剪了，发型师说要等一个钟头。时钟敲了十二下，闹钟也响了。', '我的頭髮該剪了，髮型師說要等一個鐘頭。時鐘敲了十二下，鬧鐘也響了。'],
  ['据报道，台湾地区的经济增长率在第三季度达到了百分之三点二。', '據報道，台灣地區的經濟增長率在第三季度達到了百分之三點二。'],
  ['她在图书馆里看书，后来觉得有点儿困，就回宿舍睡觉了。', '她在圖書館裡看書，後來覺得有點兒困，就回宿舍睡覺了。'],
  ['今天天气很好，我们一起去公园散步吧。', '今天天氣很好，我們一起去公園散步吧。'],
  ['Hello 世界 123！', 'Hello 世界 123！'],
  ['', ''],
  ['换行\n保留\n\n空行', '換行\n保留\n\n空行'],
];
for (const [a, b] of SENT) eq(s2t, a, b, 'sentence');
// 臺 option off keeps 臺
eq(t => s2t(t, { tai: false }), '台湾的舞台和台风，台面上的台灯', '臺灣的舞臺和颱風，檯面上的檯燈', 'tai=false');
eq(t => s2t(t, { tai: true }), '台湾的舞台和台风，台面上的台灯', '台灣的舞台和颱風，檯面上的檯燈', 'tai=true');

// ---- traditional -> simplified ----
const T2S = `乾淨>干净 乾燥>干燥 乾杯>干杯 乾隆>乾隆 乾坤>乾坤 幹部>干部 幹活>干活 才幹>才干 干擾>干扰 若干>若干 餅乾>饼干
頭髮>头发 髮型>发型 發展>发展 理髮>理发 鬍鬚>胡须 鬍子>胡子 胡說>胡说 鬚髮>须发
麵條>面条 麵包>面包 泡麵>泡面 面對>面对 裡面>里面 麵粉>面粉 炒麵>炒面
鐘錶>钟表 時鐘>时钟 鬧鐘>闹钟 鍾情>钟情 姓鍾>姓钟 錶帶>表带 手錶>手表 表示>表示 代表>代表
一隻貓>一只猫 只有>只有 隻字未提>只字未提 船隻>船只 隻身>只身
系統>系统 關係>关系 聯繫>联系 繫鞋帶>系鞋带 係數>系数 維繫>维系
複雜>复杂 重複>重复 答覆>答复 回覆>回复 恢復>恢复 復習>复习 複習>复习 復興>复兴 覆蓋>覆盖 顛覆>颠覆 反覆>反复
颱風>台风 臺灣>台湾 台灣>台湾 舞臺>舞台 檯面>台面 櫃檯>柜台 電視台>电视台 陽台>阳台
放鬆>放松 松樹>松树 輕鬆>轻松 鬆開>松开 蓬鬆>蓬松 製造>制造 制度>制度 製作>制作 複製>复制 製品>制品
計畫>计划 計劃>计划 規劃>规划 企畫>企划 筆畫>笔画 畫家>画家 劃分>划分 划算>划算
週末>周末 週年>周年 週期>周期 周圍>周围 一週>一周 每週>每周 周杰倫>周杰伦
瞭解>了解 了解>了解 明瞭>明了 瞭望>瞭望 一目瞭然>一目了然
藉口>借口 藉由>借由 藉著>借着 憑藉>凭借 狼藉>狼藉 慰藉>慰藉 借錢>借钱
佈置>布置 分佈>分布 公佈>公布 宣佈>宣布 布局>布局
什麼>什么 甚麼>什么 怎麼>怎么 那麼>那么 么妹>幺妹 老么>老幺
於是>于是 由於>由于 對於>对于 關於>关于 終於>终于 於>于
範圍>范围 模範>模范 示範>示范 范仲淹>范仲淹
註冊>注册 注意>注意 註釋>注释 備註>备注 徵求>征求 象徵>象征 特徵>特征 徵收>征收 魏徵>魏徵 宮商角徵羽>宫商角徵羽
佔領>占领 佔據>占据 佔用>占用 占卜>占卜 占星>占星 霸佔>霸占
看著>看着 接著>接着 隨著>随着 沿著>沿着 忙著>忙着 睡著了>睡着了 穿著>穿着 著名>著名 著作>著作 顯著>显著 土著>土著 著急>着急 著手>着手 著迷>着迷 著火>着火 著涼>着凉 著落>着落 著陸>着陆 著重>着重 著眼>着眼 著想>着想 執著>执着 沉著>沉着 附著>附着 衣著>衣着 有著>有着 拿著>拿着 等著>等着 說著>说着 跟著>跟着 試著>试着 名著>名著 編著>编著 原著>原著 臭名昭著>臭名昭著 著作權>著作权
鬥爭>斗争 戰鬥>战斗 北斗>北斗 奮鬥>奋斗 餘下>余下 剩餘>剩余 採訪>采访 風采>风采 穀物>谷物 山谷>山谷 睏倦>困倦 飢餓>饥饿 葉子>叶子 適合>适合
衝突>冲突 沖洗>冲洗 捨得>舍得 宿舍>宿舍 塗料>涂料 摺疊>折叠 折扣>折扣 存摺>存折 汙衊>污蔑 蔑視>蔑视
髮>发 發>发 後>后 后>后 裡>里 里>里 麵>面 面>面 鐘>钟 鍾>钟 隻>只 只>只 繫>系 係>系 複>复 復>复 覆>覆 颱>台 臺>台 鬆>松 松>松 製>制 制>制 徵>征 徴>徴
`;
for (const line of T2S.trim().split('\n')) for (const e of line.trim().split(/\s+/)) { const [a, b] = e.split('>'); eq(t2s, a, b, 't2s'); }
eq(t2s, '他看著我笑了，接著就走了。著名的作家寫了一本著作。', '他看着我笑了，接着就走了。著名的作家写了一本著作。', 't2s sentence');
eq(t2s, '乾隆皇帝的房間很乾淨，幹部們在幹活。', '乾隆皇帝的房间很干净，干部们在干活。', 't2s sentence');

// ---- Taiwan vocabulary ----
const TW = `软件>軟體 信息>資訊 网络>網路 视频>影片 内存>記憶體 鼠标>滑鼠 打印>列印 出租车>計程車 自行车>腳踏車
硬件>硬體 数据库>資料庫 服务器>伺服器 操作系统>作業系統 文件夹>資料夾 博客>部落格 激光>雷射 短信>簡訊 互联网>網際網路 屏幕>螢幕 字节>位元組 概率>機率 默认>預設 链接>連結 登录>登入 用户>使用者 搜索>搜尋 分辨率>解析度 像素>畫素 兼容>相容 编程>程式設計 算法>演算法 变量>變數 数组>陣列 模块>模組 驱动程序>驅動程式
菜单栏>選單列 下拉菜单>下拉式選單 右键菜单>右鍵選單 源代码>原始碼 写代码>寫程式碼 调用函数>呼叫函式 回调函数>回呼函式 USB接口>USB介面 调试程序>偵錯程式 运行环境>執行環境 项目经理>專案經理 应用程序>應用程式 计算机程序>電腦程式 产品质量>產品品質 质量管理>品質管理 服务质量>服務品質 代码优化>程式碼最佳化 朝鲜政府>北韓政府 奔驰车>賓士車 宝马汽车>BMW汽車 台北地铁>台北捷運 高雄地铁>高雄捷運 宕机>當機
土豆>馬鈴薯 西红柿>番茄 酸奶>優格 方便面>泡麵 冰棍>冰棒 公交车>公車 摩托车>機車 空调>冷氣 洗发水>洗髮精 创可贴>OK繃 圆珠笔>原子筆 盒饭>便當 幼儿园>幼稚園 熊猫>貓熊 悉尼>雪梨 新西兰>紐西蘭 智能手机>智慧型手機 智能>智慧 数码相机>數位相機 账号>帳號 结账>結帳 堵车>塞車 外卖>外送 菠萝>鳳梨 猕猴桃>奇異果 三文鱼>鮭魚 芝士>起司 充电宝>行動電源 点赞>按讚 工资>薪水 简历>履歷 初中>國中 酒店>飯店 计算机>電腦 笔记本电脑>筆記型電腦 台式机>桌上型電腦 人工智能>人工智慧 云计算>雲端運算 芯片>晶片 硅谷>矽谷 纳米>奈米 报道>報導 复印>影印 厘米>公分 乒乓球>桌球 世界杯>世界盃 特朗普>川普 乔布斯>賈伯斯 谷歌>Google
`;
const s2tw = t => s2t(t, { tw: true });
for (const line of TW.trim().split('\n')) for (const e of line.trim().split(/\s+/)) { const [a, b] = e.split('>'); eq(s2tw, a, b, 's2t+tw'); }
// toggle off leaves vocabulary alone
eq(s2t, '软件 信息 网络 视频 质量 程序 内存 鼠标 打印 出租车 自行车', '軟件 信息 網絡 視頻 質量 程序 內存 鼠標 打印 出租車 自行車', 's2t tw=off');
eq(s2tw, '这个软件的质量很高，程序运行得很快，内存占用也很少。', '這個軟體的品質很高，程式執行得很快，記憶體佔用也很少。', 's2t+tw sentence');
eq(s2tw, '请用鼠标点击打印按钮，把文件发送到我的邮箱。', '請用滑鼠點選列印按鈕，把文件傳送到我的信箱。', 's2t+tw sentence');
// 台灣用語 does not touch words that are not vocabulary differences, and ordinary words still convert
eq(s2tw, '支持你的类型', '支持你的類型', 's2t+tw leaves 支持/類型');
eq(s2tw, '他的头发很长', '他的頭髮很長', 's2t+tw ordinary');

// reverse: Taiwan wording back to mainland wording, then simplified
const TWR = `軟體>软件 網路>网络 程式>程序 記憶體>内存 滑鼠>鼠标 列印>打印 計程車>出租车 腳踏車>自行车 硬體>硬件 資料庫>数据库 伺服器>服务器 作業系統>操作系统 資料夾>文件夹 部落格>博客 雷射>激光 簡訊>短信 螢幕>屏幕 位元組>字节 機率>概率 選單>菜单 登入>登录 使用者>用户 解析度>分辨率 畫素>像素 程式碼>代码 演算法>算法 函式>函数 變數>变量 模組>模块 介面>接口
公車>公交车 機車>摩托车 洗髮精>洗发水 原子筆>圆珠笔 便當>盒饭 幼稚園>幼儿园 貓熊>熊猫 紐西蘭>新西兰 北韓>朝鲜 賓士>奔驰 捷運>地铁 塞車>堵车 帳號>账号 結帳>结账 筆記型電腦>笔记本电脑 人工智慧>人工智能 晶片>芯片 奈米>纳米 報導>报道 桌球>乒乓球 世界盃>世界杯 川普>特朗普 賈伯斯>乔布斯 網際網路>互联网 原始碼>源代码 OK繃>创可贴 智慧型手機>智能手机 數位相機>数码相机
資訊安全>信息安全 預設值>默认值 點選連結>点击链接 超連結>超链接 品質管理>质量管理 服務品質>服务质量 專案管理>项目管理 專案經理>项目经理 筆記型電腦>笔记本电脑
`;
const t2sw = t => t2s(t, { tw: true });
for (const line of TWR.trim().split('\n')) for (const e of line.trim().split(/\s+/)) { const [a, b] = e.split('>'); eq(t2sw, a, b, 't2s+tw'); }
eq(t2s, '軟體 資訊 網路 影片 品質', '软体 资讯 网路 影片 品质', 't2s tw=off');
eq(t2sw, '這個軟體的品質管理很好，程式執行得很快。', '这个软件的质量管理很好，程序执行得很快。', 't2s+tw sentence');
// words that are also normal mainland words are left alone by the reverse table
eq(t2sw, '文件 資料 智慧 影像 裝置 番茄 馬鈴薯', '文件 资料 智慧 影像 装置 番茄 马铃薯', 't2s+tw skips shared words');

// ---- round trips ----
const TW_TEXT = [
  '今天天氣很好，我們一起去公園散步吧。他說他明天會來，但是我不太相信。',
  '這隻小狗很可愛，只要你叫牠，牠就會搖尾巴。',
  '我的頭髮該剪了，髮型師說要等一個鐘頭。時鐘敲了十二下，鬧鐘也響了。',
  '請把房間打掃乾淨，幹部們都來了。後來皇后到了裡面，走了三公里，吃了一碗麵條。',
  '系統和關係，聯繫我們，複雜的事情重複做，答覆他，颱風來了，松樹下放鬆一下，制度和製造業。',
  '台灣的夜市很熱鬧，大家一邊吃一邊聊天，週末的時候人更多。',
  '歷史上有許多傑出的人物，他們的故事至今仍然被傳頌。',
  '這個問題非常複雜，需要仔細研究才能找到合適的答案。',
  '我們公司的產品品質很好，客戶都很滿意，業績逐年成長。',
  '他每天早上六點起床，先跑步三公里，然後吃早餐、看報紙。',
];
for (const t of TW_TEXT) { const back = s2t(t2s(t)); ok(back === t, `round trip t→s→t: ${t} → ${t2s(t)} → ${back}`); }
const CN_TEXT = [
  '今天天气很好，我们一起去公园散步吧。他说他明天会来，但是我不太相信。',
  '他的头发很长，公司的发展很快。后来皇后到了里面，走了三公里。',
  '请把房间打扫干净，干部们都来了，若干个问题。',
  '系统和关系，联系我们，复杂的事情重复做，答复他，台风来了，松树下放松一下。',
  '这个软件的质量很高，程序运行得很快，内存占用也很少。',
  '我们公司的产品质量很好，客户都很满意，业绩逐年增长。',
];
for (const t of CN_TEXT) { const back = t2s(s2t(t)); ok(back === t, `round trip s→t→s: ${t} → ${s2t(t)} → ${back}`); }
// round trip with 台灣用語 both ways
for (const t of ['这个软件的内存占用很少，硬件也不贵。', '请用鼠标点击打印按钮，然后把文件夹上传到服务器。']) {
  const tw = s2t(t, { tw: true }), back = t2s(tw, { tw: true });
  ok(back === t, `round trip with vocabulary: ${t} → ${tw} → ${back}`);
}
// idempotent: converting already-traditional text with s2t changes nothing on common text
for (const t of TW_TEXT) ok(s2t(t) === t, `s2t is idempotent on traditional text: ${t} → ${s2t(t)}`);
for (const t of CN_TEXT) ok(t2s(t) === t, `t2s is idempotent on simplified text: ${t} → ${t2s(t)}`);

// ---- segments / highlighting ----
{
  const segs = ZC.convert('头发很长，软件好。', { dir: 's2t', tw: true });
  ok(ZC.join(segs) === '頭髮很長，軟體好。', 'segments join to output');
  const ch = segs.filter(s => s.k);
  ok(ch.length === 3 && ch[0].s === '头发' && ch[0].k === 1 && ch[1].s === '长' && ch[2].s === '软件' && ch[2].k === 2 && ch[2].o === '軟體' && ch[2].p === '軟件', 'segment kinds: 1 char/phrase, 2 vocabulary with plain fallback ' + JSON.stringify(ch));
  ok(segs.some(s => s.k === 0 && s.s === '很') && segs.some(s => s.k === 0 && s.s === '，') && segs.some(s => s.k === 0 && s.s === '好。'), 'unchanged runs are kept separate from vocabulary matches ' + JSON.stringify(segs));
  const vocab = ZC.convert('这是软件工程和网络信息安全。', { dir: 's2t', tw: true });
  ok(vocab.filter(s => s.k === 2).map(s => s.s).join(',') === '软件,网络,信息', 'vocabulary segments are tight: ' + JSON.stringify(vocab));
  ok(vocab.filter(s => s.k === 0).every(s => !/[软件网络信息]/.test(s.s)), 'no vocabulary text left in unchanged runs');
  const t = ZC.convert('這個軟體很好', { dir: 't2s', tw: true });
  ok(ZC.join(t) === '这个软件很好' && t.some(s => s.k === 2 && s.s === '軟體' && s.o === '软件' && s.p === '软体'), 't2s vocabulary segment ' + JSON.stringify(t));
  const v = ZC.convert('猫陪着我。台上', { dir: 's2t' });
  ok(v.length === 4 && v[0].s === '猫' && v[0].k === 1 && v[1].s === '陪' && v[1].k === 0 && v[2].s === '着' && v[2].o === '著' && v[2].k === 1 && v[3].s === '我。台上' && v[3].k === 0, 'variant characters inside unchanged runs are marked alone: ' + JSON.stringify(v));
  const none = ZC.convert('ABC 123', { dir: 's2t' });
  ok(none.length === 1 && none[0].k === 0, 'ascii only is one unchanged segment');
}

// ---- alternatives ----
{
  const a = ZC.alts({ s: '发', o: '發', k: 1 }, { dir: 's2t' });
  ok(a[0] === '發' && a.includes('髮'), '发 alternatives include 髮: ' + a.join('/'));
  const g = ZC.alts({ s: '干', o: '幹', k: 1 }, { dir: 's2t' });
  ok(g[0] === '幹' && g.includes('乾') && g.includes('干'), '干 alternatives: ' + g.join('/'));
  const hf = ZC.alts({ s: '头发', o: '頭髮', k: 1 }, { dir: 's2t' });
  ok(hf[0] === '頭髮' && hf.includes('頭發'), '头发 alternatives: ' + hf.join('/'));
  const li = ZC.alts({ s: '里', o: '裡', k: 1 }, { dir: 's2t' });
  ok(li.includes('里') && !li.includes('裏'), '里 alternatives use Taiwan form 裡, not 裏: ' + li.join('/'));
  const tw = ZC.alts({ s: '软件', o: '軟體', k: 2, p: '軟件' }, { dir: 's2t' });
  ok(tw[0] === '軟體' && tw[1] === '軟件', 'vocabulary alternatives offer the plain conversion: ' + tw.join('/'));
  const q = ZC.alts({ s: '乾', o: '干', k: 1 }, { dir: 't2s' });
  ok(q[0] === '干' && q.includes('乾'), '乾 alternatives in t2s: ' + q.join('/'));
  const z = ZC.alts({ s: '著', o: '着', k: 1 }, { dir: 't2s' });
  ok(z.includes('著'), '著 alternatives in t2s: ' + z.join('/'));
  const none = ZC.alts({ s: '很', o: '很', k: 0 }, { dir: 's2t' });
  ok(none[0] === '很', 'unchanged alternatives');
  ok(ZC.alts({ s: '发', o: '發', k: 1 }, { dir: 's2t' }).length <= 10, 'alternatives capped');
}

// ---- custom dictionary ----
{
  const custom = [{ from: '土豆', to: '洋芋', dir: 's2t' }, { from: '软件', to: '軟件', dir: 's2t' }, { from: '軟體', to: '软体', dir: 't2s' }];
  eq(t => s2t(t, { custom, tw: true }), '土豆和软件', '洋芋和軟件', 'custom wins over vocabulary');
  eq(t => s2t(t, { custom }), '土豆和软件', '洋芋和軟件', 'custom wins over characters');
  eq(t => t2s(t, { custom, tw: true }), '軟體', '软体', 'custom in t2s wins over reverse vocabulary');
  eq(t => t2s(t, { custom: [{ from: '土豆', to: '洋芋', dir: 's2t' }] }), '土豆', '土豆', 'custom entry only applies in its direction');
  const segs = ZC.convert('土豆', { dir: 's2t', custom });
  ok(segs.length === 1 && segs[0].k === 3 && segs[0].o === '洋芋', 'custom segment kind 3');
  eq(t => s2t(t, { custom: [{ from: '头发', to: '頭髮絲', dir: 's2t' }] }), '头发长', '頭髮絲長', 'custom entries may change length');
  eq(t => s2t(t, { custom: [{ from: '长', to: '', dir: 's2t' }] }), '头发长', '頭髮', 'custom entry may delete');
}

// ---- counting ----
{
  const c = ZC.count('Hello world 你好嗎 123');
  ok(c.chars === 16 && c.cjk === 3 && c.words === 3, 'count: ' + JSON.stringify(c));
  ok(ZC.count('').chars === 0, 'count empty');
  ok(ZC.count('你好\n世界').cjk === 4, 'count ignores newlines');
}


// ---- hand-checked sample sentences and phrases (demo/samples.tsv), both directions, with and without 台灣用語 ----
{
  const rows = fs.readFileSync(path.join(__dirname, 'samples.tsv'), 'utf8').split('\n').filter(l => l && !l.startsWith('#')).map(l => l.split('\t'));
  ok(rows.length >= 300, 'at least 300 checked samples (' + rows.length + ')');
  for (const [d, tw, a, b] of rows) eq(d === 's2t' ? (t => s2t(t, { tw: tw === '1' })) : (t => t2s(t, { tw: tw === '1' })), a, b, 'sample ' + d + (tw === '1' ? '+tw' : ''));
}
// generated cross-word-boundary pairs (demo/cross-boundary.tsv): a phrase entry must not fire across two words
{
  const rows = fs.readFileSync(path.join(__dirname, 'cross-boundary.tsv'), 'utf8').split('\n').filter(l => l && !l.startsWith('#')).map(l => l.split('\t'));
  let bad = 0; for (const [d, tw, a, b] of rows) { const got = s2t(a); if (got !== b) { bad++; if (bad <= 10) console.log('FAIL cross', a, got, b); } }
  ok(rows.length > 5000 && bad === 0, 'cross-boundary pairs: ' + rows.length + ', wrong ' + bad);
}
// one-to-many fixes added on top of the OpenCC phrase list
const FIX = `冲咖啡>沖咖啡 热水冲>熱水沖 冲马桶>沖馬桶 冲奶粉>沖奶粉 冲个澡>沖個澡 冲锋>衝鋒 冲过去>衝過去 这只是>這只是 这只不过>這只不過 这只猫>這隻貓 这只能>這只能
不准确>不準確 不准时>不準時 不准>不准 系扣子>繫釦子 系围巾>繫圍巾 钟山>鍾山 余华>余華 余秋雨>余秋雨 姓余>姓余 剩余>剩餘 范老师>范老師 范围>範圍 蛋卷>蛋捲 点赞>點讚 理了个发>理了個髮 衣服干了>衣服乾了 头发干了>頭髮乾了 干了一杯>乾了一杯 干了>幹了 哭干>哭乾`;
for (const e of FIX.split(/\s+/)) { const [a, b] = e.split('>'); eq(s2t, a, b, 'fix'); }
eq(s2tw, '点赞', '按讚', 'fix keeps 台灣用語 按讚');
// edge cases: emoji, astral characters, mixed scripts, punctuation-only, very long words, control characters
eq(s2t, '😀发👍🏽', '😀發👍🏽', 'emoji kept');
eq(s2t, '𠮷野家的头发', '𠮷野家的頭髮', 'astral character kept');
eq(s2t, 'C++程序员 & <b>头发</b> "引号"', 'C++程序員 & <b>頭髮</b> "引號"', 'markup and ascii kept');
eq(s2t, '！？。，、；：「」', '！？。，、；：「」', 'punctuation only');
eq(s2t, '\t头发\r\n发型\u0000', '\t頭髮\r\n髮型\u0000', 'tabs, CRLF and NUL kept');
eq(t2s, '   ', '   ', 'spaces only');
eq(s2t, '０１２３ＡＢＣ', '０１２３ＡＢＣ', 'full-width ascii kept');

// ---- 台灣用語 is on by default, so a word with another everyday meaning is only replaced in a clear context ----
{
  const s2tw = t => s2t(t, { tw: true });
  for (const [a, b] of [['质量守恒定律', '質量守恆定律'], ['物体的质量是五公斤', '物體的質量是五公斤'], ['这个软件的质量很好', '這個軟體的品質很好'],
    ['体育项目', '體育項目'], ['我们的项目进展顺利', '我們的項目進展順利'], ['项目经理', '專案經理'], ['他发了一条信息给我', '他發了一條訊息給我'], ['他的信息很灵通', '他的資訊很靈通'],
    ['历史进程', '歷史進程'], ['法律程序', '法律程序'], ['这个程序有漏洞', '這個程式有漏洞'], ['二次函数', '二次函數'], ['这个函数返回一个数组', '這個函式回傳一個陣列'],
    ['宏观经济', '宏觀經濟'], ['微积分', '微積分'], ['并发症', '併發症'], ['刷新纪录', '刷新紀錄'], ['包罗万象', '包羅萬象'], ['他打的球', '他打的球'],
    ['食品添加剂', '食品添加劑'], ['笔记本', '筆記本'], ['结婚对象', '結婚對象'], ['售票窗口', '售票窗口'], ['好消息', '好消息'], ['党的领导', '黨的領導'],
    ['股票代码', '股票代碼'], ['列车运行', '列車運行'], ['朝鲜半岛', '朝鮮半島'], ['骏马奔驰在草原上', '駿馬奔馳在草原上'], ['看菜单点菜', '看菜單點菜'],
    ['设置障碍', '設置障礙'], ['默认设置已恢复', '預設設定已恢復'], ['这个视频的点击量很高', '這個影片的點閱量很高']]) eq(s2tw, a, b, 'tw context');
}
// ---- 台灣用語 policy: a word with an everyday (non-tech, non-brand) meaning keeps it; one negative case per word ----
{
  const s2tw = t => s2t(t, { tw: true }), t2sw = t => t2s(t, { tw: true });
  for (const [a, b] of [['骏马在草原上奔驰', '駿馬在草原上奔馳'], ['宝马香车', '寶馬香車'], ['餐厅的菜单', '餐廳的菜單'], ['服务员拿来了菜单', '服務生拿來了菜單'],
    ['水管接口漏水了', '水管接口漏水了'], ['光速和质量有关', '光速和質量有關'], ['质量和能量', '質量和能量'], ['我在北京坐地铁', '我在北京坐地鐵'],
    ['上海地铁站', '上海地鐵站'], ['正弦函数', '正弦函數'], ['法律程序很复杂', '法律程序很複雜'], ['审批程序', '審批程序'], ['比赛项目', '比賽項目'],
    ['列车运行', '列車運行'], ['股票代码', '股票代碼'], ['朝鲜王朝', '朝鮮王朝'], ['设置机构', '設置機構'], ['硬币上的头像', '硬幣上的頭像'],
    ['激活市场', '激活市場'], ['优化结构', '優化結構'], ['股价回调', '股價回調'], ['他的字体很漂亮', '他的字體很漂亮'], ['孕妇禁用', '孕婦禁用'],
    ['远程导弹', '遠程導彈'], ['队列训练', '隊列訓練'], ['产业集群', '產業集群'], ['调试设备', '調試設備'], ['转发文件', '轉發文件'], ['本科生', '本科生'],
    ['为候选人站台', '為候選人站台'], ['前台和后台', '前台和後台'], ['废品回收站', '廢品回收站'], ['加粗钢筋', '加粗鋼筋'], ['建筑模板', '建築模板'],
    ['抄送给他', '抄送給他'], ['兼容并包', '兼容並包'], ['历史进程', '歷史進程'], ['宏大', '宏大'], ['一次性付清', '一次性付清']]) eq(s2tw, a, b, 'tw keeps everyday meaning');
  for (const [a, b] of [['法律程序很複雜', '法律程序很复杂'], ['正當程序', '正当程序'], ['呼叫中心', '呼叫中心'], ['他的報告', '他的报告'], ['部門主管', '部门主管'],
    ['我的導師', '我的导师'], ['失業率', '失业率'], ['封鎖消息', '封锁消息'], ['富豪榜', '富豪榜'], ['這部影片', '这部影片'], ['我的電腦', '我的电脑'],
    ['品質高尚', '品质高尚'], ['冰糖雪梨', '冰糖雪梨'], ['軟體動物', '软体动物'], ['解方程式', '解方程式'], ['程式化', '程式化'], ['冷氣團', '冷气团'],
    ['獅子山', '狮子山'], ['叮噹作響', '叮当作响'], ['桌布', '桌布'], ['喇叭', '喇叭'], ['重新整理資料', '重新整理资料'], ['你是我的最愛', '你是我的最爱'],
    ['隻言片語', '只言片语'], ['游標卡尺', '游标卡尺'], ['副本', '副本'], ['底線', '底线'], ['物件', '物件'], ['外掛', '外挂']]) eq(t2sw, a, b, 'tw reverse keeps everyday meaning');
}
// ---- 台灣用語 collocations: an ambiguous word converts only inside a clear computer phrase ----
{
  const s2tw = t => s2t(t, { tw: true });
  for (const [a, b] of [['请在设置中开启通知', '請在設定中開啟通知'], ['打开手机设置，找到蓝牙', '打開手機設定，找到藍牙'], ['请把窗口最大化', '請把視窗最大化'],
    ['他在调用一个函数', '他在呼叫一個函式'], ['把这个对象传给函数', '把這個物件傳給函式'], ['这个接口返回JSON数据', '這個介面回傳JSON資料'],
    ['这台设备支持蓝牙', '這台裝置支援藍牙'], ['电脑的性能很好', '電腦的效能很好'], ['这个软件的运行速度很快', '這個軟體的執行速度很快'],
    ['在菜单里选择保存', '在選單裡選擇儲存'], ['让程序在后台运行', '讓程式在背景執行'], ['这个函数有两个参数', '這個函式有兩個參數'],
    ['这台电脑支持USB接口', '這台電腦支援USB介面'], ['他是这个项目的负责人', '他是這個專案的負責人'], ['软件项目的进度', '軟體專案的進度'],
    ['午饭吃快餐', '午飯吃速食'], ['他办了一张身份证', '他辦了一張身分證'], ['我在下载文件', '我在下載檔案'], ['网络连接失败', '網路連線失敗'], ['请打开文件夹', '請打開資料夾']]) eq(s2tw, a, b, 'tw collocation');
  // …but never the everyday meaning, even with a tech word in the same clause, and a maths clause keeps 函數 / 圖像
  for (const [a, b] of [['二次函数的图像是抛物线', '二次函數的圖像是拋物線'], ['正弦函数的图像', '正弦函數的圖像'], ['他在餐厅看菜单，然后用手机拍照', '他在餐廳看菜單，然後用手機拍照'],
    ['售票窗口在电脑旁边', '售票窗口在電腦旁邊'], ['用手机找对象', '用手機找對象'], ['法律程序在网站上公布', '法律程序在網站上公布'], ['股票代码', '股票代碼'],
    ['消化系统运行良好', '消化系統運行良好'], ['感谢大家对我们软件的支持', '感謝大家對我們軟體的支持'], ['这个比赛项目的负责人', '這個比賽項目的負責人'],
    ['这个项目需要三个人', '這個項目需要三個人'], ['医院的设备很先进', '醫院的設備很先進'], ['我们要保存体力', '我們要保存體力'], ['政府发布了新的文件', '政府發布了新的文件'],
    ['社会运行良好', '社會運行良好'], ['他设置了一个陷阱', '他設置了一個陷阱'], ['这个窗口卖票', '這個窗口賣票'], ['她有对象了', '她有對象了']]) eq(s2tw, a, b, 'tw clause keeps everyday meaning');
}
// ---- a tech word elsewhere in the sentence changes nothing (no sentence-level guessing) ----
{
  const s2tw = t => s2t(t, { tw: true });
  for (const [a, b] of [['他用手机扫码看菜单点了一碗牛肉面', '他用手機掃碼看菜單點了一碗牛肉麵'], ['他每天晚上在手机上和对象聊天', '他每天晚上在手機上和對象聊天'],
    ['粉丝们在网站上留言支持这位歌手', '粉絲們在網站上留言支持這位歌手'], ['工人正在安装水管接口', '工人正在安裝水管接口'], ['他在网站上看到运动员刷新了世界纪录', '他在網站上看到運動員刷新了世界紀錄'],
    ['政府在网站上公布了这份文件的全文', '政府在網站上公布了這份文件的全文'], ['他照着网站上的教程替换了厨房的灯泡', '他照著網站上的教程替換了廚房的燈泡'],
    ['他用手机拍下了钟表的指针', '他用手機拍下了鐘錶的指針'], ['网站上写着办理签证的程序', '網站上寫著辦理簽證的程序'], ['妈妈用手机拍下孩子触摸小狗的样子', '媽媽用手機拍下孩子觸摸小狗的樣子'],
    ['政府网站宣布撤销这项处罚', '政府網站宣布撤銷這項處罰'], ['记者用手机记录了工厂的运行情况', '記者用手機記錄了工廠的運行情況'], ['城市交通系统运行良好', '城市交通系統運行良好'],
    ['防御系统设置在山顶上', '防禦系統設置在山頂上'], ['这个灌溉系统的设备很先进', '這個灌溉系統的設備很先進'], ['他从剧场后台的窗口往外看', '他從劇場後台的窗口往外看'],
    ['界面活性剂可以保存很久', '界面活性劑可以保存很久'], ['剧团在后台添加了几件道具', '劇團在後台添加了幾件道具'], ['这个比赛项目的负责人', '這個比賽項目的負責人']]) eq(s2tw, a, b, 'tw no sentence guessing');
  for (const [a, b] of [['我在银行排队的时候用手机把App窗口最大化了', '我在銀行排隊的時候用手機把App視窗最大化了'], ['他在餐厅里用电脑打开设置菜单把字体调大', '他在餐廳裡用電腦打開設定選單把字型調大'],
    ['点击右上角的菜单，选择导出', '點選右上角的選單，選擇匯出'], ['在电脑上把这个文件拖到回收站', '在電腦上把這個檔案拖到資源回收筒'], ['程序崩溃以后要重新运行', '程式崩潰以後要重新執行'],
    ['这个程序调用正弦函数画出曲线', '這個程式呼叫正弦函數畫出曲線'], ['这款手机的性能已经到了极限', '這款手機的效能已經到了極限'], ['方程式赛车的App支持多种语言', '方程式賽車的App支援多種語言'],
    ['我们用微信视频聊天', '我們用微信視訊聊天'], ['刷新页面', '重新整理頁面'], ['鼠标指针', '滑鼠指標'], ['添加好友', '新增好友'], ['撤销操作', '復原操作'], ['触摸屏', '觸控式螢幕']]) eq(s2tw, a, b, 'tw collocation');
  const t2sw = t => t2s(t, { tw: true });
  for (const [a, b] of [['請在設定中開啟藍牙', '请在设置中开启蓝牙'], ['這個程式的效能很好', '这个程序的性能很好'], ['這款手機支援快速充電', '这款手机支持快速充电']]) eq(t2sw, a, b, 'tw reverse collocation');
}
// ---- 乾/幹, 托福 ----
for (const [a, b] of [['墙上的涂料干了', '牆上的塗料乾了'], ['墙刚刷完还没干', '牆剛刷完還沒乾'], ['他还没干完', '他還沒幹完'], ['他每天干干活，看看书', '他每天幹幹活，看看書'],
  ['干干净净', '乾乾淨淨'], ['他在准备托福考试', '他在準備托福考試'], ['托福成绩', '托福成績'], ['他只只都要', '他隻隻都要'], ['钟钟表表', '鐘鐘錶錶']]) eq(s2t, a, b, '乾/幹 托福 AA');
// ---- repeated characters (AA / AABB) read the same way twice ----
for (const [a, b] of [['郁郁葱葱', '鬱鬱蔥蔥'], ['郁郁寡欢', '鬱鬱寡歡'], ['郁郁不乐', '鬱鬱不樂'], ['郁郁乎文哉', '郁郁乎文哉'], ['干干净净', '乾乾淨淨'], ['松松垮垮', '鬆鬆垮垮'],
  ['面面俱到', '面面俱到'], ['面面相觑', '面面相覷'], ['蒙蒙细雨', '濛濛細雨'], ['怒气冲冲', '怒氣沖沖'], ['发发牢骚', '發發牢騷'], ['里里外外', '裡裡外外'],
  ['历历在目', '歷歷在目'], ['坛坛罐罐', '罈罈罐罐'], ['气喘吁吁', '氣喘吁吁'], ['干巴巴', '乾巴巴']]) eq(s2t, a, b, 'AA/AABB');
// ---- X后 + 来: a title ending in 后 keeps 后 (太后來了), a time word before 后来 still gives 後來 ----
for (const [a, b] of [['太后来到花园', '太后來到花園'], ['天后来台湾开演唱会', '天后來台灣開演唱會'], ['歌后来了', '歌后來了'], ['影后来了', '影后來了'],
  ['皇后来了', '皇后來了'], ['王后来自邻国', '王后來自鄰國'], ['母后来了', '母后來了'], ['皇太后来了', '皇太后來了'], ['慈禧太后来了', '慈禧太后來了'],
  ['乐坛天后来台', '樂壇天后來台'], ['小天后来了', '小天后來了'], ['后妃', '后妃'], ['天后宫', '天后宮'], ['皇天后土', '皇天后土'],
  ['三天后来了', '三天後來了'], ['几天后来', '幾天後來'], ['第二天后来', '第二天後來'], ['3天后来', '3天後來'], ['星期天后来', '星期天後來'], ['那天后来', '那天後來'],
  ['聊天后来', '聊天後來'], ['唱歌后来', '唱歌後來'], ['唱完歌后就走了', '唱完歌後就走了'], ['太太后来', '太太後來'], ['老太太后来', '老太太後來'],
  ['犹太后裔', '猶太後裔'], ['午后来访', '午後來訪'], ['然后来了', '然後來了'], ['最后来的人', '最後來的人']]) eq(s2t, a, b, 'X后+来');
// ---- X体制 + 造成: every 体制 reads the same, whatever comes before it ----
for (const p of ['旧', '新', '老', '原', '现', '该', '其', '这种', '管理', '经济', '政治', '教育', '现行', '官僚', '医疗', '落后'])
  eq(s2t, p + '体制造成的问题', s2t(p) + '體制造成的問題', 'X体制+造成');
eq(s2t, '被制造成玩具', '被製造成玩具', '制造成'); eq(s2t, '整体制造成本', '整體製造成本', '制造成本');
// ---- 四周: surroundings keep 周, a span of four weeks is 週 ----
for (const [a, b] of [['环顾四周', '環顧四周'], ['四周都是树', '四周都是樹'], ['房子四周', '房子四周'], ['四周一片寂静', '四周一片寂靜'], ['四周围', '四周圍'],
  ['四周后', '四週後'], ['第四周', '第四週'], ['四周年', '四週年'], ['四周内', '四週內'], ['为期四周', '為期四週'], ['持续四周', '持續四週'],
  ['四周的时间', '四週的時間'], ['过去四周', '過去四週'], ['三周后', '三週後'], ['一周年', '一週年']]) eq(s2t, a, b, '四周');
// ---- word-boundary families: a common word ending on the first character of a frequent phrase keeps its character ----
{
  // X面 + 条…/包… : 方面条件 is 方面 + 条件, not 方 + 面条 + 件
  for (const x of ['这方面', '各方面', '多方面', '一方面', '两方面', '全面', '表面', '正面', '反面', '里面', '外面', '前面', '后面', '上面', '下面', '地面', '会面', '局面', '场面', '书面', '层面', '版面', '路面', '水面', '画面'])
    for (const [y, yt] of [['条件', '條件'], ['包括', '包括'], ['条款', '條款'], ['包含', '包含']]) { const want = s2t(x) + yt; eq(s2t, x + y, want, 'X面 family'); }
  eq(s2t, '这个面包括三部分。', '這個面包括三部分。', 'X面 family');
  // common word ending in 头 + the verb 发: 回头发个消息 is 回头 + 发, but 白头发 / 掉头发 are hair
  for (const x of ['回头', '抬头', '点头', '低头', '埋头', '扭头', '转头', '街头', '码头', '源头', '带头'])
    for (const [y, yt] of [['发个消息', '發個消息'], ['发邮件给我', '發郵件給我'], ['发你', '發你'], ['发给他', '發給他']]) { const want = s2t(x) + yt; eq(s2t, x + y, want, 'X头+发 family'); }
  for (const x of ['白', '黑', '掉', '剪', '染', '洗', '烫', '拔', '长', '短', '金', '一根白', '满头白']) eq(s2t, x + '头发', s2t(x) + '頭髮', 'X+头发 family');
  for (const [a, b] of [['倘若干不完就加班', '倘若幹不完就加班'], ['他在公司干系统维护', '他在公司幹系統維護'], ['能干净利落地完成', '能乾淨利落地完成'],
    ['他回归家庭', '他回歸家庭'], ['回归自然', '回歸自然'], ['回归正常', '回歸正常'], ['线性回归分析', '線性迴歸分析'], ['北回归线', '北迴歸線'], ['钟声响了', '鐘聲響了']]) eq(s2t, a, b, 'boundary');
}
// ---- custom dictionary file: export → clear → import gives back exactly the same entries ----
{
  const list = [
    { from: '軟體', to: '软件', dir: 't2s' },        // 繁→簡 must stay 繁→簡
    { from: 'A,B', to: 'C', dir: 's2t' },            // comma inside an entry
    { from: '甲→乙', to: '丙=>丁', dir: 's2t' },      // arrows and => inside an entry
    { from: 'x=>y', to: 'p,q→r', dir: 't2s' },
    { from: '#井號開頭', to: '#號', dir: 's2t' },      // looks like a comment line
    { from: '土豆', to: '', dir: 's2t' },            // empty "to" (deletes the word)
    { from: '空 格', to: ' 前後 有空格 '.trim(), dir: 's2t' },
    { from: '😀表情', to: '𠮷', dir: 't2s' },
  ];
  const text = ZC.dictText(list);
  const back = ZC.parseDict(text);
  ok(JSON.stringify(back.out) === JSON.stringify(list) && back.bad === 0, 'dictionary export/import round-trips exactly: ' + JSON.stringify(back));
  ok(JSON.stringify(ZC.parseDict(text.replace(/\n/g, '\r\n')).out) === JSON.stringify(list), 'dictionary round-trip survives CRLF line breaks');
  ok(JSON.stringify(ZC.parseDict('﻿' + text).out) === JSON.stringify(list), 'dictionary round-trip survives a BOM');
  // files written by the previous version (same tab format, older header line) still import
  const old = '# 簡繁轉換 自訂詞典：原文<Tab>轉成<Tab>方向（簡→繁 或 繁→簡）\n軟體\t软件\t繁→簡\n土豆\t洋芋\t簡→繁\n';
  ok(JSON.stringify(ZC.parseDict(old).out) === JSON.stringify([{ from: '軟體', to: '软件', dir: 't2s' }, { from: '土豆', to: '洋芋', dir: 's2t' }]), 'older export imports with directions kept');
  // hand-written lines and JSON
  const hw = ZC.parseDict('面条,面線,簡→繁\n头发→頭髮\n软件=>軟體\n壞行\n# 註解\n軟體,软件,繁→簡\n');
  ok(JSON.stringify(hw.out) === JSON.stringify([{ from: '面条', to: '面線', dir: 's2t' }, { from: '头发', to: '頭髮', dir: 's2t' }, { from: '软件', to: '軟體', dir: 's2t' }, { from: '軟體', to: '软件', dir: 't2s' }]) && hw.bad === 1, 'hand-written dictionary lines: ' + JSON.stringify(hw));
  ok(JSON.stringify(ZC.parseDict(JSON.stringify(list)).out) === JSON.stringify(list), 'JSON dictionary imports');
  ok(ZC.cleanEntry('a\tb\nc ') === 'a b c', 'tabs and line breaks never get into an entry');
}

// ---- performance ----
{
  const big = '他的头发很长，公司的发展很快。这个软件的质量很高，程序运行得很快。'.repeat(3000); // ~100k characters
  const t0 = Date.now(); s2t(big, { tw: true }); const ms = Date.now() - t0;
  ok(ms < 2500, `100k chars with vocabulary in ${ms} ms`);
  const t1 = Date.now(); t2s(s2t(big), { tw: true }); const ms2 = Date.now() - t1;
  ok(ms2 < 3000, `100k chars reverse in ${ms2} ms`);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
