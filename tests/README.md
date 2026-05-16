Run with
ARCHIVE_MODE=cli STRESS_SIZE=small EXHAUSTIVE=true npx jest tests/* --maxWorkers=12
ARCHIVE_MODE=fallback STRESS_SIZE=small EXHAUSTIVE=true npx jest tests/* --maxWorkers=12
ARCHIVE_MODE=cli STRESS_SIZE=medium npx jest tests/* --maxWorkers=12
ARCHIVE_MODE=fallback STRESS_SIZE=medium npx jest tests/* --maxWorkers=12
ARCHIVE_MODE=cli STRESS_SIZE=large npx jest tests/* --maxWorkers=12
ARCHIVE_MODE=fallback STRESS_SIZE=large npx jest tests/* --maxWorkers=12

or 

ARCHIVE_MODE=fallback STRESS_SIZE=small npm test -- --maxWorkers=12