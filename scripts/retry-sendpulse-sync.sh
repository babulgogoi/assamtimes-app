#!/bin/bash
# Wrapper so the cron entry only needs this one short path instead of a
# long cd && node && redirect one-liner. See retry-sendpulse-sync.js for
# what this actually does.
cd /home/assam1/web/assamtimes.org/private/app || exit 1
/usr/bin/node scripts/retry-sendpulse-sync.js >> logs/retry-sendpulse-sync.log 2>&1
