from pathlib import Path
import re

ROOTS = [
    Path("external/wiki_yv_txt"),
    Path("external/wiki_yv_txt_tree/wiki_yv"),
]

MISSING_PUNCT = re.compile(r"(?<![\u0964\u0965]) ([\u0966-\u096F]+)$")
SARGA_TOKEN = "सर्गः"

changed_files = 0
changed_lines = 0

for root in ROOTS:
    if not root.exists():
        continue

    for path in root.rglob("*.txt"):
        original = path.read_text(encoding="utf-8")
        lines = original.splitlines(keepends=True)
        touched = False
        out = []

        for line in lines:
            newline = ""
            body = line
            if line.endswith("\r\n"):
                body = line[:-2]
                newline = "\r\n"
            elif line.endswith("\n"):
                body = line[:-1]
                newline = "\n"

            if SARGA_TOKEN not in body:
                updated = MISSING_PUNCT.sub(r" ।। \1", body)
                if updated != body:
                    touched = True
                    changed_lines += 1
                    body = updated

            out.append(body + newline)

        if touched:
            path.write_text("".join(out), encoding="utf-8")
            changed_files += 1

print(f"changed_files={changed_files}")
print(f"changed_lines={changed_lines}")
