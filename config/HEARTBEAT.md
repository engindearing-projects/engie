# Heartbeat Check (every 30 minutes)

When the heartbeat fires, run through this checklist. Only report items that have changes or need attention — skip anything unchanged.

## Priority 1: Deadlines
- Check all Jira tickets with due dates in the next 7 days
- Alert immediately if anything is overdue
- Flag tickets due in <3 days that aren't "In Progress" or "Done"

## Priority 2: CI/CD Health
- Check GitHub Actions status for key repos (configured per org)
- Report any failing CI runs on dev or main branches
- Flag PRs that have been open >48 hours without review

## Priority 3: Blockers
- Check for tickets marked as blocked
- Check devops/ops board for pending requests that block development
- Identify dependency chains at risk

## Priority 4: Activity
- Note any new PRs opened since last heartbeat
- Note any PRs merged since last heartbeat
- Note any new Jira tickets created or transitioned

## Reporting Rules
- If nothing noteworthy: log silently, don't message the user
- If 1-2 minor items: batch and deliver at next standup
- If urgent (overdue deadline, failing CI on dev, blocked critical path): message immediately
- Never send more than 3 heartbeat messages per hour unless critical
