import asyncio, os, sys, re
sys.path.insert(0, ".")
os.environ.setdefault("TANKAUCTION_ID", "zgamez")
os.environ.setdefault("TANKAUCTION_PW", "young1!")

from http_client import make_client, login

async def main():
    async with make_client() as client:
        await login(client)
        resp = await client.get("/ca/caView.php?tid=2500112")
        html = resp.text
        with open("tank_page.html", "w", encoding="utf-8") as f:
            f.write(html)
        js_paths = set(re.findall(r'src="(/dist/[^"]+\.js[^"]*)"', html))
        with open("tank_js_paths.txt", "w", encoding="utf-8") as f:
            for p in sorted(js_paths):
                f.write(p + "\n")
        print(js_paths)

asyncio.run(main())
