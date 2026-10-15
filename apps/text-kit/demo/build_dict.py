import sys,json,os
D=sys.argv[1]
def load(f):
    out=[]
    for line in open(os.path.join(D,f),encoding='utf8'):
        if line.startswith('#') or not line.strip(): continue
        k,v=line.rstrip('\n').split('\t'); out.append((k,v.split(' ')))
    return out
def build(charf,phrf):
    cm={}
    for k,v in load(charf):
        if len(k)==1: cm[k]=v[0]
    ph=[]
    for k,v in load(phrf):
        t=v[0]
        conv=''.join(cm.get(c,c) for c in k)
        if conv!=t and len(k)<=8 and len(k)==len(t): ph.append((k,t))
    # char string: pairs where differs
    cs=''.join(k+v for k,v in cm.items() if k!=v)
    # phrases: store key + diff-encoded value: key then value
    ps='|'.join(k+t for k,t in ph)
    return cs,ps,len(ph)
s_cs,s_ps,n1=build('STCharacters.txt','STPhrases.txt')
t_cs,t_ps,n2=build('TSCharacters.txt','TSPhrases.txt')
tw=load('TWPhrases.txt'); twv=load('TWVariants.txt')
DROP=set('局部 全局 循環 實例 文件 程序 進程 打開 刷新 卸載 參數 句柄 屏蔽 審覈 聯繫 權限 擴展 視圖 查看 調度 截取 集成 映射 數組 鏡像 激活 交互 對象 低級 高級 高端 拋出 溢出 算子 重載 重裝 死機 聲明 呼出 調製 字庫 分區 調用 數字 地址 模擬 通道 預設 範式 彙編 宏 訪問 諾蘭 盤片 調試 批量 社區 散列 哈希 端口 綁定 多態 掛斷 相冊 圖庫 凱奇 拉洛 拉莫 福雷 薩蒂 賴希 香農 歐拉 捲積 復印'.split())
BAD=('域性','迴圈','例項','許可權','擴充套件','重新整理','解除安裝','引數','控制代碼','結束通話','宕機','字型檔','對映','套件')
tw=[(k,v) for k,v in tw if k not in DROP and v[0]!=k and not any(b in v[0] for b in BAD)]
tws='|'.join(k+'\t'+v[0] for k,v in tw)
twvs=''.join(k+v[0] for k,v in twv if len(k)==1 and len(v[0])==1)
data={'s2tC':s_cs,'s2tP':s_ps,'t2sC':t_cs,'t2sP':t_ps,'twP':tws,'twV':twvs}
js='const ZH='+json.dumps(data,ensure_ascii=False,separators=(',',':'))+';'
open(sys.argv[2],'w',encoding='utf8').write(js)
print(n1,n2,len(tw),{k:len(v.encode()) for k,v in data.items()}, len(js.encode()))
