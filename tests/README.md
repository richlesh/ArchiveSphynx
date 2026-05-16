Run with
ARCHIVE_MODE=cli npx jest tests/* --maxWorkers=12
ARCHIVE_MODE=fallback npx jest tests/* --maxWorkers=12

or 

ARCHIVE_MODE=fallback npm test -- --maxWorkers=12