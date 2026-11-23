"""Resize the existing club logo for platform build assets; no redesign or generated art."""
from pathlib import Path
import json
from PIL import Image
root=Path(__file__).resolve().parents[1]
logo=Image.open(root/'assets/sai-logo.png').convert('RGBA')
mobile=root/'mobile_flutter'
def icon(path,size,padding=.14):
    background=Image.new('RGB',(size,size),'white')
    side=round(size*(1-2*padding));image=logo.resize((side,side),Image.Resampling.LANCZOS)
    background.paste(image,((size-side)//2,(size-side)//2),image)
    path.parent.mkdir(parents=True,exist_ok=True);background.save(path)
icons=mobile/'ios/Runner/Assets.xcassets/AppIcon.appiconset'
for entry in json.loads((icons/'Contents.json').read_text())['images']:
    if 'filename' in entry:icon(icons/entry['filename'],round(float(entry['size'].split('x')[0])*float(entry['scale'][:-1])))
launch=mobile/'ios/Runner/Assets.xcassets/LaunchImage.imageset'
for scale in (1,2,3):icon(launch/('LaunchImage'+(f'@{scale}x' if scale>1 else '')+'.png'),68*scale,0)
for density,size in [('mdpi',48),('hdpi',72),('xhdpi',96),('xxhdpi',144),('xxxhdpi',192)]:icon(mobile/f'android/app/src/main/res/mipmap-{density}/ic_launcher.png',size)
icon(mobile/'android/app/src/main/res/drawable-nodpi/sai_logo.png',138,0)
