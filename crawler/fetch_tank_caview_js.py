import asyncio, os, sys, re
sys.path.insert(0, ".")
os.environ.setdefault("TANKAUCTION_ID", "zgamez")
os.environ.setdefault("TANKAUCTION_PW", "young1!")
from http_client import make_client, login

async def main():
    async with make_client() as client:
        await login(client)
        resp = await client.get("/dist/ca/js/caView-FV6xkJQ7.js")
        js = resp.text
        with open("tank_caview.js", "w", encoding="utf-8") as f:
            f.write(js)
        chunks = set(re.findall(r'"(\.\./\.\./chunks/[a-zA-Z0-9_/.-]+\.js)"', js))
        with open("tank_chunk_paths.txt", "w", encoding="utf-8") as f:
            for c in sorted(chunks):
                f.write(c + "\n")
        print(len(chunks))

asyncio.run(main())
