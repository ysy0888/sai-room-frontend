"""Sync the reviewed web renderer into the offline native visual widget."""
from pathlib import Path
import argparse, shutil, sys
root=Path(__file__).resolve().parents[1]
target=root/'mobile_flutter/assets/scene'
files=['css/styles.css','css/motion.css','css/bottle.css','js/member-bottle.js','js/soft-physics.js','js/bottle-3d.js','js/bottle-3d.js.LEGAL.txt']
files += [str(p.relative_to(root)) for p in (root/'assets/fonts').glob('*') if p.is_file()]
parser=argparse.ArgumentParser();parser.add_argument('--check',action='store_true');args=parser.parse_args()
stale=[]
for name in files:
    source=root/name; destination=target/name
    if args.check:
        if not destination.exists() or source.read_bytes()!=destination.read_bytes():stale.append(name)
    else:
        destination.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,destination)
if stale:sys.exit('Mobile scene is stale: '+', '.join(stale))
print('Mobile scene matches the web renderer.' if args.check else 'Mobile scene synchronized.')
