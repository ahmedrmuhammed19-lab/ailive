#!/bin/bash
# DL-21 — Storage forensics: what does the platform dashboard count vs what we control?
# Re-runnable. Plain-text sections, safe to run repeatedly.

S=$(date +%s)
echo "== [0] run at $(date -u +%Y-%m-%dT%H:%M:%SZ) =="

echo
echo "== [1] df -h : ALL mounts (what the platform likely counts) =="
df -h

echo
echo "== [2] df -h on key paths =="
df -h / /home /home/z /home/z/my-project 2>/dev/null

echo
echo "== [3] du -d1 /home/z (our controllable root) =="
du -h -d1 /home/z 2>/dev/null | sort -rh

echo
echo "== [4] du -d2 /home/z/my-project (project breakdown) =="
du -h -d2 /home/z/my-project 2>/dev/null | sort -rh | head -25

echo
echo "== [5] du -sh writable suspects OUTSIDE /home/z (system layer) =="
du -sh /root /tmp /var/tmp /var/log /var/cache /opt /srv /home 2>/dev/null | sort -rh

echo
echo "== [6] du -xh -d1 / (root overlay only, -x = same filesystem) =="
du -xh -d1 / 2>/dev/null | sort -rh | head -12

echo
echo "== [7] mount table (types & sources) =="
mount 2>/dev/null

E=$(date +%s)
echo
echo "== [8] done in $((E-S))s =="
