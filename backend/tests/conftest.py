"""Tests always run against the local seed files and stubs, whatever is in backend/.env.

Without this, a developer with DATA_BACKEND=supabase in .env would run the suite against the
live database (and its real content, which the tests do not expect).
"""

import os

os.environ["DATA_BACKEND"] = "local"
os.environ["AI_PROVIDER"] = "stub"
os.environ["AUTH_MODE"] = "stub"
os.environ["INCLUDE_UNREVIEWED"] = "false"
