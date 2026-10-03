test:
    pnpm test

typecheck:
    pnpm typecheck

check: test typecheck

benchmark-dry:
    pnpm benchmark:dry

benchmark:
    pnpm benchmark

demo:
    pnpm demo

serve:
    pnpm serve

e2e:
    pnpm test:e2e

ci: check e2e
