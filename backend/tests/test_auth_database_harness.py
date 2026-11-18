"""Regression for a disposable Postgres restart after pg_isready succeeds."""

import importlib.util
import subprocess
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[2] / "scripts/check_auth_database.py"
spec = importlib.util.spec_from_file_location("check_auth_database", SCRIPT)
assert spec and spec.loader
harness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)


class DatabaseConnectionRetryTests(unittest.TestCase):
    def test_transient_connection_refusal_after_main_process_starts_recovers(self):
        attempts = 0

        def ping(statement):
            nonlocal attempts
            self.assertEqual(statement, "select 1;")
            attempts += 1
            if attempts == 1:
                raise subprocess.CalledProcessError(2, "psql", output="connection refused")
            return "1"

        with patch.object(harness.subprocess, "run", return_value=SimpleNamespace(returncode=0)) as run, \
             patch.object(harness.time, "sleep"):
            harness.wait_database("disposable-postgres", ping)
        self.assertEqual(attempts, 2)
        probe = run.call_args.args[0]
        self.assertIn("/proc/1/comm", " ".join(probe))
        self.assertIn("pg_isready", " ".join(probe))

    def test_sql_errors_do_not_retry(self):
        attempts = 0

        def ping(_statement):
            nonlocal attempts
            attempts += 1
            raise subprocess.CalledProcessError(3, "psql", output="invalid SQL")

        with patch.object(harness.subprocess, "run", return_value=SimpleNamespace(returncode=0)), \
             patch.object(harness.time, "sleep"):
            with self.assertRaises(subprocess.CalledProcessError):
                harness.wait_database("disposable-postgres", ping)
        self.assertEqual(attempts, 1)


if __name__ == "__main__":
    unittest.main()
