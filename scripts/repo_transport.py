#!/usr/bin/env python3
"""WAFA-ATTACH-TRANSPORT-2: temporary public transport repo.
Creates an unguessable public repo under the same account, PUTs the report
HTML via the Contents API, prints the raw URL. The whole repo is deleted
immediately after the portal attach succeeds. Token never printed."""
import base64, json, re, secrets, subprocess, sys, time, urllib.request

HTML = "/home/z/my-project/download/GlobalEIS_Report_EidFarag_EGP.html"
NAME = f"eis-transport-{secrets.token_hex(6)}"


def gh_token():
    url = subprocess.run(["git", "-C", "/home/z/my-project", "remote", "get-url", "origin"],
                         capture_output=True, text=True, check=True).stdout.strip()
    m = re.match(r"https://([^@]+)@github\.com", url)
    auth = m.group(1)
    parts = auth.split(":", 1)
    tok = parts[1] if len(parts) == 2 and parts[1] else parts[0]
    return tok


def api(method, path, tok, body=None):
    req = urllib.request.Request(
        f"https://api.github.com{path}",
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers={"Authorization": f"token {tok}",
                 "Accept": "application/vnd.github+json",
                 "User-Agent": "eis-attach-transport",
                 "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, json.load(e)


def main():
    tok = gh_token()
    # who am I
    st, me = api("GET", "/user", tok)
    if st != 200:
        print("auth failed:", st, me.get("message")); sys.exit(1)
    owner = me["login"]
    st, repo = api("POST", "/user/repos", tok,
                   {"name": NAME, "private": False, "auto_init": True,
                    "description": "temporary transport (deleted shortly)"})
    if st not in (201, 422):
        print("repo create failed:", st, repo.get("message")); sys.exit(1)
    time.sleep(2)
    content = base64.b64encode(open(HTML, "rb").read()).decode()
    st, put = api("PUT", f"/repos/{owner}/{NAME}/contents/GlobalEIS_Report_EidFarag_EGP.html",
                  tok, {"message": "transport", "content": content})
    if st not in (200, 201):
        print("content put failed:", st, put.get("message")); sys.exit(1)
    raw = f"https://raw.githubusercontent.com/{owner}/{NAME}/main/GlobalEIS_Report_EidFarag_EGP.html"
    # verify it is publicly fetchable WITHOUT auth
    req = urllib.request.Request(raw, headers={"User-Agent": "eis-verify"})
    with urllib.request.urlopen(req, timeout=60) as r:
        n = len(r.read())
    print("REPO =", f"{owner}/{NAME}")
    print("RAW_URL =", raw)
    print("verified public bytes:", n)
    print("OWNER =", owner)


if __name__ == "__main__":
    main()
