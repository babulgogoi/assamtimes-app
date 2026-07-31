#!/bin/bash
# Run after each session to update CLAUDE.md git log section
cd /home/assam1/web/assamtimes.org/private/app
RECENT=$(git log --oneline -30)
echo "Last updated: $(date)" > /home/assam1/web/assamtimes.org/private/app/.claude-session-log
echo "$RECENT" >> /home/assam1/web/assamtimes.org/private/app/.claude-session-log
echo "Claude memory log saved to .claude-session-log"
