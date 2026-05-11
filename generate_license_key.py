#!/usr/bin/env python3
import sys
import hmac
import hashlib

SALT = "ArchiveSphynx-2026"

if len(sys.argv) != 2:
    print("Usage: generate_license_key.py <name>")
    sys.exit(1)

name = sys.argv[1].lower().strip()
key = hmac.new(SALT.encode(), name.encode(), hashlib.sha256).hexdigest()[:16].upper()
formatted = "-".join(key[i:i+4] for i in range(0, 16, 4))
print(formatted)
