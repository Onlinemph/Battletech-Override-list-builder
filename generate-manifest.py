import os, json

IMAGE_DIR = 'images'
VALID_EXT = {'.png', '.jpg', '.jpeg', '.webp'}
manifest = {}

if os.path.isdir(IMAGE_DIR):
    for cat in sorted(os.listdir(IMAGE_DIR)):
        cat_path = os.path.join(IMAGE_DIR, cat)
        if not os.path.isdir(cat_path):
            continue
        files = sorted(f for f in os.listdir(cat_path) if os.path.splitext(f)[1].lower() in VALID_EXT)
        if files:
            manifest[cat] = files

with open('manifest.json', 'w') as f:
    json.dump(manifest, f, indent=2)

print(f"manifest.json: {len(manifest)} categories, {sum(len(v) for v in manifest.values())} images")
