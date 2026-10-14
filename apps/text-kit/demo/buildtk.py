import sys
src=open(sys.argv[1],encoding='utf8').read(); zh=open(sys.argv[2],encoding='utf8').read()
assert '/*ZHDATA*/' in src
open(sys.argv[3],'w',encoding='utf8').write(src.replace('/*ZHDATA*/',zh,1))
