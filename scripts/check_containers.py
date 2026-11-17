"""Offline deployment smoke check. Build pidsklom-{api,web}:check first; no cloud credentials needed."""

import argparse
import json
import re
import subprocess
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def docker(*args: str) -> str:
    return subprocess.check_output(["docker", *args], text=True).strip()


def request(url: str, *, method: str = "GET", data: dict | None = None, status: int = 200):
    headers = {"Content-Type": "application/json"} if data is not None else {}
    req = Request(url, data=json.dumps(data).encode() if data is not None else None, headers=headers, method=method)
    try:
        response = urlopen(req, timeout=10)
    except HTTPError as exc:
        response = exc
    with response:
        if response.status != status:
            raise RuntimeError(f"{method} {url}: expected {status}, got {response.status}: {response.read()!r}")
        return response.read(), response.headers


def wait_ready(url: str) -> None:
    for attempt in range(30):
        try:
            request(url)
            return
        except (URLError, TimeoutError, ConnectionError):
            if attempt == 29:
                raise
            time.sleep(1)


def check(api_image: str, web_image: str) -> None:
    containers: list[str] = []
    try:
        api = docker(
            "run", "--rm", "--detach", "--memory=512m", "--cpus=0.5",
            "--publish", "127.0.0.1::8100",
            "--env", "PORT=8100", "--env", "AUTH_MODE=disabled", api_image,
        )
        containers.append(api)
        web = docker(
            "run", "--rm", "--detach", "--publish", "127.0.0.1::8180",
            "--env", "PORT=8180", web_image,
        )
        containers.append(web)
        api_url = "http://" + docker("port", api, "8100/tcp")
        web_url = "http://" + docker("port", web, "8180/tcp")
        wait_ready(f"{api_url}/api/ready")
        wait_ready(f"{web_url}/")
        for container in containers:
            if docker("exec", container, "id", "-u") == "0":
                raise RuntimeError("Application containers must not run as root")

        artworks = json.loads(request(f"{api_url}/api/artworks")[0])
        if not artworks["items"]:
            raise RuntimeError("Container catalogue is empty")
        artwork = artworks["items"][0]
        request(f"{api_url}/api/artworks/{artwork['id']}")
        image_path = artwork["image_url"].split("/static/", 1)[1]
        request(f"{api_url}/static/{image_path}")
        match = json.loads(request(
            f"{api_url}/api/matches", method="POST", data={"phrase": "коли дедлайн завтра"}, status=201,
        )[0])
        if not match["alternatives"]:
            raise RuntimeError("Offline matching returned no alternatives")
        request(f"{api_url}/api/memes", status=403)
        request(
            f"{api_url}/api/memes", method="POST",
            data={"artwork_id": artwork["id"], "style": {"blocks": [{"text": "test"}]}}, status=403,
        )
        home, _ = request(f"{web_url}/")
        nested, headers = request(f"{web_url}/create/painting/1/own")
        if nested != home or "no-cache" not in headers.get("Cache-Control", ""):
            raise RuntimeError("SPA nested-route fallback/cache policy failed")
        asset = re.search(rb'src="(/assets/[^"]+\.js)"', home)
        if not asset:
            raise RuntimeError("Built frontend JavaScript was not found")
        _, headers = request(web_url + asset[1].decode())
        if "immutable" not in headers.get("Cache-Control", ""):
            raise RuntimeError("Hashed assets are missing immutable caching")
        request(f"{web_url}/assets/nonexistent.js", status=404)
        print("Container smoke checks passed: readiness, content/images, matching, account gate, SPA and assets.")
        print(docker("stats", "--no-stream", "--format", "{{.Name}}: {{.MemUsage}}", *containers))
    except Exception:
        for container in containers:
            subprocess.run(["docker", "logs", "--tail", "60", container], check=False)
        raise
    finally:
        for container in containers:
            subprocess.run(["docker", "stop", "--time", "5", container], check=True, stdout=subprocess.DEVNULL)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-image", default="pidsklom-api:check")
    parser.add_argument("--web-image", default="pidsklom-web:check")
    args = parser.parse_args()
    check(args.api_image, args.web_image)
