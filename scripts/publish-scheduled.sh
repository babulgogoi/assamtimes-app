#!/bin/bash
# Wrapper so the HestiaCP cron UI only needs this one short path instead of
# a long cd && node && redirect one-liner. See publish-scheduled.js for
# what this actually does.
cd /home/assam1/web/assamtimes.org/private/app || exit 1
/usr/bin/node scripts/publish-scheduled.js >> logs/publish-scheduled.log 2>&1
