import asyncio, os, sys
sys.path.insert(0, ".")
os.environ.setdefault("TANKAUCTION_ID", "zgamez")
os.environ.setdefault("TANKAUCTION_PW", "young1!")
from http_client import make_client, login

async def main():
    async with make_client() as client:
        await login(client)
        resp = await client.get("/dist/chunks/DetailView-CQ3CSBRz.js")
        with open("tank_detailview.js", "w", encoding="utf-8") as f:
            f.write(resp.text)
        print(len(resp.text))

asyncio.run(main())
