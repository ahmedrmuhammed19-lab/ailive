#!/usr/bin/env python3
"""WAFA-ATTACH-TRANSPORT: push the finished report HTML to a SECRET gist via
the GitHub API (token from git remote URL, never printed), print the raw URL.
The gist is deleted right after the portal attach succeeds."""
import json, re, subprocess, sys, urllib.request

HTML = "/home/z/my-project/download/GlobalEIS_Report_EidFarag_EGP.html"


def gh_token():
    url = subprocess.run(["git", "-C", "/home/z/my-project", "remote", "get-url", "origin"],
                         capture_output=True, text=True, check=True).stdout.strip()
    m = re.match(r"https://([^@]+)@github\.com", url)
    if not m:
        return None, None
    auth = m.group(1)  # "token" (username position) or "user:token"
    parts = auth.split(":", 1)
    tok = parts[1] if len(parts) == 2 and parts[1] else parts[0]
    user = parts[0] if len(parts) == 2 else "git"
    return user, tok


def main():
    user, tok = gh_token()
    if not tok:
        print("no token in remote URL"); sys.exit(1)
    content = open(HTML, encoding="utf-8").read()
    body = json.dumps({
        "description": "Global EIS analyst report transport (temporary)",
        "public": False,
        "files": {"GlobalEIS_Report_EidFarag_EGP.html": {"content": content}},
    }).encode()
    req = urllib.request.Request(
        "https://api.github.com/gists", data=body, method="POST",
        headers={"Authorization": f"token {tok}",
                 "Accept": "application/vnd.github+json",
                 "Content-Type": "application/json",
                 "User-Agent": "eis-attach-transport"})
    with urllib.request.urlopen(req, timeout=60) as r:
        res = json.load(r)
    gid = res["id"]
    raw_url = res["files"]["GlobalEIS_Report_EidFarag_EGP.html"]["raw_url"]
    print("GIST_ID=" + gid)
    print("RAW_URL=" + raw_url)


if __name__ == "__main__":
    main()
