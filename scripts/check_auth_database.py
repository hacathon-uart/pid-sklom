#!/usr/bin/env python3
"""Exercise production quota SQL on disposable Postgres, never a configured Supabase project."""

import concurrent.futures
import json
from pathlib import Path
import secrets
import subprocess
import time
import uuid


def main():
    name = f"pidsklom-auth-sql-{uuid.uuid4().hex[:12]}"

    def sql(statement):
        return subprocess.check_output(
            ["docker", "exec", "-i", name, "psql", "-U", "postgres", "-At", "-v", "ON_ERROR_STOP=1"],
            input=statement, text=True, stderr=subprocess.STDOUT,
        ).strip()

    def begin(actor, request_id=None, kind="match", digest="same", limited=True):
        request_id = request_id or str(uuid.uuid4())
        result = sql(
            f"select operation_begin('{actor}', '{request_id}', '{kind}', '{digest}', {str(limited).lower()});"
        )
        return request_id, json.loads(result)

    def finish(actor, request_id, lease, success=True):
        return sql(
            f"""select operation_finish('{actor}', '{request_id}', '{lease}', '{{"ok":true}}', {str(success).lower()});"""
        )

    subprocess.run([
        "docker", "run", "--detach", "--rm", "--name", name,
        "-e", f"POSTGRES_PASSWORD={secrets.token_urlsafe(32)}", "postgres:17-alpine",
    ], check=True, stdout=subprocess.DEVNULL)
    try:
        for _ in range(60):
            probe = subprocess.run(
                ["docker", "exec", name, "pg_isready", "-U", "postgres"],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            if probe.returncode == 0:
                break
            time.sleep(1)
        else:
            raise RuntimeError("Disposable Postgres did not become ready")
        sql("create role anon; create role authenticated; create role service_role;")
        migration = Path(__file__).resolve().parents[1] / "data/migrations/0001_auth_operations.sql"
        sql(migration.read_text())
        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
            attempts = list(pool.map(lambda _: begin("guest:concurrent"), range(10)))
        admitted = [(key, result) for key, result in attempts if result["status"] == "started"]
        assert len(admitted) == 3, attempts
        assert sum(result["status"] == "limited" for _, result in attempts) == 7
        key, result = admitted[0]
        assert begin("guest:concurrent", key)[1]["status"] == "pending"
        assert begin("guest:concurrent", key, digest="changed")[1]["status"] == "conflict"
        assert finish("guest:concurrent", key, result["lease"]) == "t"
        assert begin("guest:concurrent", key)[1] == {"status": "complete", "response": {"ok": True}}
        key, result = admitted[1]
        assert finish("guest:concurrent", key, result["lease"], False) == "t"
        assert sql("select operation_remaining('guest:concurrent');") == "1"
        assert begin("guest:concurrent", key, kind="captions")[1]["status"] == "conflict"
        retry = begin("guest:concurrent", key)[1]
        assert retry["status"] == "started" and retry["lease"] != result["lease"]
        assert finish("guest:concurrent", key, result["lease"]) == "f"
        sql(f"update app_operations set lease_until=now()-interval '1 second' where request_id='{key}';")
        assert sql("select operation_remaining('guest:concurrent');") == "1"
        assert finish("guest:concurrent", key, retry["lease"]) == "f"
        assert begin("guest:concurrent", key)[1]["status"] == "started"
        assert begin("user:account", limited=False)[1]["status"] == "started"
        assert begin("guest:concurrent", kind="save", limited=False)[1]["status"] == "started"
        assert sql("select operation_remaining('guest:concurrent');") == "0"
        for role in ("anon", "authenticated"):
            assert sql(f"select has_function_privilege('{role}', 'operation_begin(text,uuid,text,text,boolean)', 'execute');") == "f"
            assert sql(f"select has_table_privilege('{role}', 'app_operations', 'select');") == "f"
        print("PASS: atomic three-slot quota, replay, payload conflict, failure/expiry recovery, fencing and RPC privileges")
    finally:
        subprocess.run(["docker", "rm", "--force", name], check=True, stdout=subprocess.DEVNULL)


if __name__ == "__main__":
    main()
